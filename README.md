# landslide-analysis-wayanad-idukki
Landslide Damage Analysis – Idukki & Wayanad

This project is about analyzing landslide damage in the districts of Idukki and Wayanad, Kerala, using Google Earth Engine (GEE).
I worked with Sentinel-1 SAR, Sentinel-2, and DEM data, and applied a Random Forest classifier to identify landslide-affected areas, track land cover changes, and calculate the percentage of damage to forests, plantations, and settlements.

🌍 Why this project?

The Western Ghats are one of the most landslide-prone regions in India. Districts like Idukki and Wayanad are especially vulnerable because of steep slopes, heavy rainfall, and human activities such as deforestation and unplanned land use.

This project aims to:

Map the areas affected by landslides

Compare before and after conditions using satellite data

Quantify how much forest, farmland, and built-up areas were damaged

Compare the damage patterns in Idukki vs Wayanad

🔑 Main Objectives

Detect and map landslide-affected zones

Carry out land cover change detection (forest loss, increase in barren land, etc.)

Provide damage statistics in percentage for each class

Compare two districts side by side

🛰️ Data Used

Sentinel-1 SAR – for surface deformation and slope movement

Sentinel-2 – for vegetation and land cover monitoring

DEM (SRTM / ALOS) – for slope and elevation analysis

ROI shapefiles – boundaries of Idukki and Wayanad

⚙️ How I did it

Collected Sentinel-1, Sentinel-2, and DEM data in GEE

Did preprocessing: cloud masking, terrain correction, filtering

Extracted features like NDVI, slope, SAR backscatter

Used Random Forest classifier to separate affected and unaffected areas

Compared pre- and post-event imagery

Calculated land cover damage percentages

📊 Results

Generated landslide classification maps for both districts

Found significant forest loss and increase in barren land in the affected regions

Created damage percentage reports for each land cover type

Produced maps, before/after comparisons, and charts

🖥️ Tools & Tech

Google Earth Engine (GEE) – main analysis

Sentinel-1 SAR & Sentinel-2 – datasets

DEM (SRTM / ALOS) – terrain info

Random Forest – classification

QGIS – for visualization and final maps
