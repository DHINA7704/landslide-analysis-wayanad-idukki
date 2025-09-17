// Center the map on the region of interest
Map.centerObject(roi);

// Add 'landtype' property to each feature collection
forest_pre = forest_pre.map(function(feature) {
    return feature.set('landtype', 1); // 1 for Forest
});
barren_pre = barren_pre.map(function(feature) {
    return feature.set('landtype', 2); // 2 for Barren
});
built_pre = built_pre.map(function(feature) {
    return feature.set('landtype', 3); // 3 for Built-up
});
forest_post = forest_post.map(function(feature) {
    return feature.set('landtype', 1); // 1 for Forest
});
barren_post = barren_post.map(function(feature) {
    return feature.set('landtype', 2); // 2 for Barren
});
built_post = built_post.map(function(feature) {
    return feature.set('landtype', 3); // 3 for Built-up
});

// Enhanced cloud masking function for Sentinel-2
function maskS2CloudsEnhanced(image) {
    var cloudProb = image.select('MSK_CLDPRB'); // Cloud probability mask
    var cloudMask = cloudProb.lt(20); // Stricter threshold for cloud probability
    var qa = image.select('QA60');
    var cloudBitMask = 1 << 10;
    var cirrusBitMask = 1 << 11;
    var qaMask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
    var scl = image.select('SCL');
    var clearPixels = scl.eq(4).or(scl.eq(5)).or(scl.eq(6)).or(scl.eq(7)); // Land categories
    var combinedMask = cloudMask.and(qaMask).and(clearPixels);
    return image.updateMask(combinedMask)
        .select(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'])
        .multiply(0.0001);
}

// Pre-event Sentinel-2 image collection
var dataset_pre = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2024-01-01', '2024-07-30')
    .filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(maskS2CloudsEnhanced)
    .median();

// Post-event Sentinel-2 image collection
var dataset_post = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2024-07-31', '2024-12-31')
    .filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(maskS2CloudsEnhanced)
    .median();
    

Map.addLayer(dataset_pre.clip(roi), {
    min: 0,
    max: 0.3,
    bands: ['B4', 'B3', 'B2']
}, 'Pre-Event Original Satellite Image');

Map.addLayer(dataset_post.clip(roi), {
    min: 0,
    max: 0.3,
    bands: ['B4', 'B3', 'B2']
}, 'Post-Event Original Satellite Image');


// Add additional spectral indices
function addIndices(image) {
    var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI'); // Vegetation
    var evi = image.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
            'NIR': image.select('B8'),
            'RED': image.select('B4'),
            'BLUE': image.select('B2')
        }).rename('EVI'); // Enhanced Vegetation Index
    var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI'); // Normalized Difference Water Index
    var ndbi = image.normalizedDifference(['B11', 'B8']).rename('NDBI'); // Built-up areas
    return image.addBands(ndvi).addBands(evi).addBands(ndwi).addBands(ndbi);
}

dataset_pre = addIndices(dataset_pre);
dataset_post = addIndices(dataset_post);

// Clip the dataset to ROI
dataset_pre = dataset_pre.clip(roi);
dataset_post = dataset_post.clip(roi);

// Clip the training samples to ROI
var trainingSamples = forest_pre.merge(barren_pre).merge(built_pre)
    .merge(forest_post).merge(barren_post).merge(built_post)
    .filterBounds(roi);  // Only keep samples within the ROI

// Sample input data for training
var training = dataset_pre.sampleRegions({
    collection: trainingSamples,
    properties: ['landtype'],
    scale: 10
});

// Train the classifier
var classifier = ee.Classifier.smileRandomForest(200).train({  // Increased trees from 100 to 200
    features: training,
    classProperty: 'landtype',
    inputProperties: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12', 'NDVI', 'EVI', 'NDWI', 'NDBI']
});

// Apply the classifier within ROI
var pre_classified = dataset_pre.classify(classifier);
var post_classified = dataset_post.classify(classifier);

// Clip the classified images to the ROI
pre_classified = pre_classified.clip(roi);
post_classified = post_classified.clip(roi);

// Apply a mode filter to the post-classified image to reduce noise
var smoothed_post_classified = post_classified.focal_mode({
    radius: 1, // Radius in pixels
    kernelType: 'circle', // Use a circular kernel
    iterations: 1 // Single iteration for smoothing
}).clip(roi);

// Pre-event visualization
var preClassificationVis = {
    min: 1,
    max: 3, // Forest, Barren, Built-up
    palette: ['2d6906', 'ffef4c', 'f00a0a'] // Forest = Green, Barren = Yellow, Built-up = Red
};

// Improved Post-event visualization
var postClassificationVis = {
    min: 1,
    max: 3, // Forest, Barren, Built-up
    palette:  ['2d6906', 'ffef4c', 'f00a0a']  // Forest = Deep Green, Barren = Bright Yellow, Built-up = Dark Red
};

// Add layers to the map
Map.addLayer(pre_classified, preClassificationVis, 'Pre-Landslide Classification');
Map.addLayer(post_classified, postClassificationVis, 'Post-Landslide Classification');

// Class names
var classNames = ['Forest', 'Barren', 'Built-up'];

// Calculate and display area statistics within ROI
var preAreas = calculateLandTypeArea(pre_classified, classNames, roi, 'Pre-Landslide');
var postAreas = calculateLandTypeArea(post_classified, classNames, roi, 'Post-Landslide');

// Calculate percentage change in each land type
function calculatePercentageChange(preAreas, postAreas) {
    var percentageChanges = {};
    
    classNames.forEach(function(className) {
        var preArea = preAreas[className];
        var postArea = postAreas[className];
        
        var change = ((postArea - preArea) / preArea) * 100;
        percentageChanges[className] = change;
        
        print(className + ' - Pre-event Area: ' + preArea + ' m², Post-event Area: ' + postArea + ' m², Change: ' + change.toFixed(2) + '%');
    });
    
    return percentageChanges;
}

function calculateLandTypeArea(classifiedImage, classNames, roi, label) {
    var areas = {};  // To store area values
    
    classNames.forEach(function(className, index) {
        var classValue = index + 1;  // Land class values: 1 for Forest, 2 for Barren, 3 for Built-up
        var area = classifiedImage.eq(classValue)  // Check if the pixel value matches the class
            .multiply(ee.Image.pixelArea().divide(10000))  // Multiply by pixel area in hectares
            .reduceRegion({
                reducer: ee.Reducer.sum(),
                geometry: roi,
                scale: 10,
                maxPixels: 1e9
            }).get('classification');  // Get sum of area for the specific class
        
        area =  ee.Number(area).getInfo();  // Convert to a usable number
        areas[className] = area || 0;  // Store the area
        
        if (area === null) {
            print(label + ' - No area found for ' + className);
        } else {
            print(label + ' - Area for ' + className + ':', area, 'hectares');
        }
    });
    
    return areas;
}

// Class names
var classNames = ['Forest', 'Barren', 'Built-up'];

// Calculate and display area statistics within ROI
var preAreas = calculateLandTypeArea(pre_classified, classNames, roi, 'Pre-Landslide');
var postAreas = calculateLandTypeArea(post_classified, classNames, roi, 'Post-Landslide');

// Calculate and display percentage changes
var percentageChanges = calculatePercentageChange(preAreas, postAreas);

// Create UI panels to display results
// Create the UI panel with a structured table-like layout
// Create the UI panel with an expanded layout to avoid scrolling
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
