// Define region of interest
Map.centerObject(geometry); // Adjust the zoom level as needed
Map.addLayer(geometry, {
  color: 'red',           // Border color
  fillColor: '00000000'   // Transparent interior
}, 'ROI Border');

// Pre-event Sentinel-2 image collection
var dataset_pre = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2020-01-01', '2020-08-04')
    .filterBounds(geometry)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 5))
    .map(maskS2Clouds)
    .median();

// Post-event Sentinel-2 image collection
var dataset_post = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2020-08-10', '2020-12-31')
    .filterBounds(geometry)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 5))
    .map(maskS2Clouds)
    .median();

// Function to mask clouds for Sentinel-2
function maskS2Clouds(image) {
    var cloudProb = image.select('MSK_CLDPRB');
    var cloudMask = cloudProb.lt(10);
    var qa = image.select('QA60');
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;
    var qaMask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
    var scl = image.select('SCL');
    var clearPixels = scl.eq(4).or(scl.eq(5)).or(scl.eq(6)).or(scl.eq(7));
    return image.updateMask(cloudMask.and(qaMask).and(clearPixels))
        .select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'])
        .multiply(0.0001);
}

// Function to compute additional spectral indices
function addIndices(image) {
    var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
    var evi = image.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
            'NIR': image.select('B8'),
            'RED': image.select('B4'),
            'BLUE': image.select('B2')
        }).rename('EVI');
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI'); // Water index
    var ndbi = image.normalizedDifference(['B11', 'B8']).rename('NDBI'); // Built-up index
    return image.addBands(ndvi).addBands(evi).addBands(ndwi).addBands(ndbi);
}

// Apply spectral index function to datasets
dataset_pre = addIndices(dataset_pre).clip(geometry);
dataset_post = addIndices(dataset_post).clip(geometry);

// Function to set land type and extract spectral bands
function setLandTypeWithBands(feature, type, image) {
    var values = image.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: feature.geometry(),
        scale: 10,
        maxPixels: 1e13
    });

    return feature.set('landtype', type).setMulti(values);
}

// Apply function to feature collections
forest_pre = forest_pre.map(function(feature) { return setLandTypeWithBands(feature, 1, dataset_pre); });
bareland_pre = bareland_pre.map(function(feature) { return setLandTypeWithBands(feature, 2, dataset_pre); });
teaplantation_pre = teaplantation_pre.map(function(feature) { return setLandTypeWithBands(feature, 3, dataset_pre); });
built_pre = built_pre.map(function(feature) { return setLandTypeWithBands(feature, 4, dataset_pre); });

forest_post = forest_post.map(function(feature) { return setLandTypeWithBands(feature, 1, dataset_post); });
bareland_post = bareland_post.map(function(feature) { return setLandTypeWithBands(feature, 2, dataset_post); });
teaplantation_post = teaplantation_post.map(function(feature) { return setLandTypeWithBands(feature, 3, dataset_post); });
built_post = built_post.map(function(feature) { return setLandTypeWithBands(feature, 4, dataset_post); });

// Merge training samples
var trainingSamples = ee.FeatureCollection([])
    .merge(forest_pre).merge(bareland_pre)
    .merge(teaplantation_pre).merge(built_pre)
    .merge(forest_post).merge(bareland_post)
    .merge(teaplantation_post).merge(built_post)
    .filterBounds(geometry);

// Class names for visualization
var classNames = ['Forest', 'Barren Land', 'Tea Plantation', 'Built-up Area'];

// **Updated classification visualization parameters**
var classificationVis = {
    min: 1,
    max: 4,
    palette: ['#1c8637', '#ffff07', '#8a0b9c', '#ff0000'] // Adjusted tea plantation to green
};

// Train classifier and classify images
var classifier = ee.Classifier.smileRandomForest(100).train({
    features: trainingSamples,
    classProperty: 'landtype',
    inputProperties: dataset_pre.bandNames()
});
var pre_classified = dataset_pre.classify(classifier);
var post_classified = dataset_post.classify(classifier);

// Function to calculate area for each land type
function calculateLandTypeArea(classifiedImage, classNames, roi, label) {
    var areas = {};  // To store area values
    
    classNames.forEach(function(className, index) {
        var classValue = index + 1;  // Land class values: 1 for Forest, 2 for Barren, 3 for Tea Plantation, 4 for Built-up
        var area = classifiedImage.eq(classValue)  // Check if the pixel value matches the class
            .multiply(ee.Image.pixelArea().divide(10000))  // Multiply by pixel area in hectares
            .reduceRegion({
                reducer: ee.Reducer.sum(),
                geometry: roi,
                scale: 10,
                maxPixels: 1e9
            }).get('classification');  // Get sum of area for the specific class
        
        area = ee.Number(area).getInfo();  // Convert to a usable number
        areas[className] = area || 0;  // Store the area
        
        if (area === null) {
            print(label + ' - No area found for ' + className);
        } else {
            print(label + ' - Area for ' + className + ':', area, 'hectares');
        }
    });
    
    return areas;
}

// Calculate area statistics for pre-event classification
var preAreas = calculateLandTypeArea(pre_classified, classNames, geometry, 'Pre-Landslide');

// Calculate area statistics for post-event classification
var postAreas = calculateLandTypeArea(post_classified, classNames, geometry, 'Post-Landslide');

// Calculate percentage changes for each land type
var percentageChanges = {};
classNames.forEach(function(className) {
    var preArea = preAreas[className];
    var postArea = postAreas[className];
    var change = ((postArea - preArea) / preArea) * 100;
    percentageChanges[className] = change;
});

// Print results
print('Pre-Landslide Areas:', preAreas);
print('Post-Landslide Areas:', postAreas);
print('Percentage Changes:', percentageChanges);

// Display raw satellite images (True Color Visualization)
var trueColorVis = {
    bands: ['B4', 'B3', 'B2'],
    min: 0,
    max: 0.3
};

Map.addLayer(dataset_pre, trueColorVis, 'Pre-Landslide Raw Image (True Color)');
Map.addLayer(dataset_post, trueColorVis, 'Post-Landslide Raw Image (True Color)');

// Display classification results
Map.addLayer(pre_classified, classificationVis, 'Pre-Landslide Classification');
Map.addLayer(post_classified, classificationVis, 'Post-Landslide Classification');

var uiPanel = ui.Panel({
    style: {
        position: 'top-right',
        padding: '16px',
        backgroundColor: '#ffffffdd',
        border: '2px solid #cccccc',
        width: '400px'  // Increased width to fit more content
    }
});

var title = ui.Label({
    value: 'Land Use Change Analysis',
    style: {
        fontSize: '20px', fontWeight: 'bold', margin: '10px', textAlign: 'center'
    }
});

// Create a header row for the table with expanded width
var headerRow = ui.Panel([
    ui.Label({ value: 'Land Type', style: { fontWeight: 'bold', width: '120px' } }),
    ui.Label({ value: 'Pre (ha)', style: { fontWeight: 'bold', width: '80px', textAlign: 'right' } }),
    ui.Label({ value: 'Post (ha)', style: { fontWeight: 'bold', width: '80px', textAlign: 'right' } }),
    ui.Label({ value: 'Change (%)', style: { fontWeight: 'bold', width: '100px', textAlign: 'right' } })
], ui.Panel.Layout.Flow('horizontal'));

// Function to create a row for each land use type with expanded width
function createLandUseRow(name, preValue, postValue, changeValue) {
    return ui.Panel([
        ui.Label({ value: name, style: { width: '120px' } }),
        ui.Label({ value: preValue.toFixed(2), style: { width: '80px', textAlign: 'right' } }),
        ui.Label({ value: postValue.toFixed(2), style: { width: '80px', textAlign: 'right' } }),
        ui.Label({ 
            value: (changeValue > 0 ? '+' : '') + changeValue.toFixed(2) + '%', 
            style: { 
                width: '100px', 
                textAlign: 'right', 
                color: changeValue < 0 ? 'red' : 'green', 
                fontWeight: 'bold' 
            } 
        })
    ], ui.Panel.Layout.Flow('horizontal'));
}

// Add title and header row
uiPanel.add(title);
uiPanel.add(headerRow);

// Populate rows dynamically with larger spacing
classNames.forEach(function(className) {
    uiPanel.add(createLandUseRow(className, preAreas[className], postAreas[className], percentageChanges[className]));
});

// Add padding to improve readability
uiPanel.add(ui.Label(''));  // Adds extra spacing at the bottom

// Add the panel to the map
Map.add(uiPanel);

// Add area statistics and percentage changes for each land type
classNames.forEach(function(className) {
    // Pre-event area label
    var preAreaLabel = ui.Label('Pre-Landslide ' + className + ' Area: ' + preAreas[className].toFixed(2) + ' ha');
    uiPanel.add(preAreaLabel);

    // Post-event area label
    var postAreaLabel = ui.Label('Post-Landslide ' + className + ' Area: ' + postAreas[className].toFixed(2) + ' ha');
    uiPanel.add(postAreaLabel);

    // Percentage change label
    var change = percentageChanges[className];
    var changeText = (change < 0 ? change.toFixed(2) + '% (decreased)' : change.toFixed(2) + '% (increased)');
    var changeLabel = ui.Label(className + ' Change: ' + changeText);
    uiPanel.add(changeLabel);

    // Add a separator between land types
    uiPanel.add(ui.Label(' ')); // Empty label for spacing
});

// Validation and accuracy assessment
var validation_pre = pre_classified.sampleRegions({
    collection: trainingSamples,
    properties: ['landtype'],
    scale: 10
});

var validation_post = post_classified.sampleRegions({
    collection: trainingSamples,
    properties: ['landtype'],
    scale: 10
});

// Calculate error matrices for pre-event and post-event classifications
var testAccuracyPre = validation_pre.errorMatrix('landtype', 'classification');
var testAccuracyPost = validation_post.errorMatrix('landtype', 'classification');






// Get the overall accuracy for both pre-event and post-event classifications
var overallAccuracyPre = testAccuracyPre.accuracy();
var overallAccuracyPost = testAccuracyPost.accuracy();

// Convert to numbers and print the overall accuracy
overallAccuracyPre.evaluate(function(accPre) {
  overallAccuracyPost.evaluate(function(accPost) {
    

    // Calculate the combined overall accuracy (average of pre and post)
    var combinedAccuracy = (accPre + accPost) / 2;  // Use JavaScript arithmetic for native numbers
    print('Combined Overall Accuracy: ' + combinedAccuracy.toFixed(2));
  });
});
// Create a chart for land use change
var chart = ui.Chart.array.values({
    array: [
        [preAreas['Forest'], postAreas['Forest']],
        [preAreas['Barren Land'], postAreas['Barren Land']],
        [preAreas['Tea Plantation'], postAreas['Tea Plantation']],
        [preAreas['Built-up Area'], postAreas['Built-up Area']]
    ],
    axis: 0
})
.setChartType('ColumnChart')
.setOptions({
    title: 'Land Use Change (Pre vs Post)',
    hAxis: { title: 'Land Cover Type' },
    vAxis: { title: 'Area (ha)' },
    colors: ['green', 'red'],
    legend: { position: 'top' },
    series: {
        0: { label: 'Pre' },
        1: { label: 'Post' }
    }
});

// Create a UI panel for the chart and table
var chartPanel = ui.Panel({
    style: {
        position: 'bottom-right',
        padding: '10px',
        backgroundColor: '#ffffffdd',
        border: '2px solid #cccccc',
        width: '400px'
    }
});

// Ensure preAreas and postAreas contain valid numbers
print('Pre-Landslide Areas:', preAreas);
print('Post-Landslide Areas:', postAreas);

// Convert preAreas and postAreas into an array for the chart
var chartDataArray = [
    ['Land Type', 'Pre-Landslide Area (ha)', 'Post-Landslide Area (ha)']
].concat(classNames.map(function(className) {
    return [
        className,
        preAreas[className] || 0,
        postAreas[className] || 0
    ];
}));

// Ensure preAreas and postAreas contain valid numbers
print('Pre-Landslide Areas:', preAreas);
print('Post-Landslide Areas:', postAreas);

// Convert preAreas and postAreas into an array for the chart
var chartDataArray = [
    ['Land Type', 'Pre-Landslide Area (ha)', 'Post-Landslide Area (ha)']
].concat(classNames.map(function(className) {
    return [
        className,
        preAreas[className] || 0,
        postAreas[className] || 0
    ];
}));

// Create a bar chart using UI components
var barChart = ui.Chart.array.values({
    array: chartDataArray.slice(1), // Exclude header row
    axis: 0
})
.setChartType('ColumnChart')
.setOptions({
    title: 'Pre vs. Post Landslide Land Cover Areas',
    hAxis: { title: 'Land Type' },
    vAxis: { title: 'Area (ha)', minValue: 0 },
    colors: ['#1f77b4', '#d62728'], // Blue for Pre, Red for Post
    legend: { position: 'top' },
    width: 400, // Reduced width
    height: 300, // Reduced height
    bar: { groupWidth: '60%' }
});

// Create a UI panel for the chart (moved to the left)
var chartPanel = ui.Panel({
    style: {
        position: 'bottom-left', // Moved to the left side
        padding: '10px',
        backgroundColor: '#ffffffdd',
        border: '2px solid #cccccc',
        width: '350px' // Slightly reduced width
    }
});


// Add the panel to the map
Map.add(chartPanel);
