```md
# Adding Raster Tiles to the Map

In this section raster tiles will be added to the map. The API response that was previously retrieved will serve as the source of the tile layer URL.

Mapbox expects a raster tile layer to be supplied as a URL in the form:

```

[https://example.com/path/to/pngdir/{x}/{y}/{z}](https://example.com/path/to/pngdir/{x}/{y}/{z})

```

The URL representation describes a set of square images located at cartesian positions `(x, y)` on a grid determined by a set of zoom levels `(z)`. This URL is expressed with templating semantics which are fairly ubiquitous across web map and tile-serving applications, but Mapbox specifically requires the TileJSON specification when working with tile sources.

---

## Locating the Tile URL in the API Response

The API response obtained earlier contains a reference to a tile layer and a URL, which for your own benefit should be found within the metadata by skimming the contents.

If you are unable to find it, look within the following hierarchy address:

```

.data.attributes.layer[0].attributes.layerConfig.source.tiles[0]

```

Datasets and Layers accessed through the API are not guaranteed to have the same structuring of their `layerConfig` object, which means there may be a need to investigate each dataset in a more comprehensive way than is being demonstrated here. Since this is a tutorial, some of this logic is going to be hardcoded for now.

---

## Example Tile Layer URL

For the given dataset, you will see a tile layer URL that looks like:

```

[https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.7/tcd_{thresh}/{z}/{x}/{y}.png](https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.7/tcd_{thresh}/{z}/{x}/{y}.png)

```

This URL is close to what is needed by Mapbox, but there is a templated component `{thresh}` which will not be suitable for Mapbox to consume.

In this case, the URL is templated beyond what is expected by the application and may be troublesome. By browsing the layer object in the API response it is possible to find some additional attributes for how the layer parameters are configured.

For this specific case, there is a parameterization array at the address:

```

.data.attributes.layer[0].attributes.layerConfig.params_config

````

That parameterization array looks like:

```json
...
"params_config": [
  {
    "default": 30,
    "key": "thresh",
    "required": true
  }
],
...
````

By using this parameterization data, the URL can be transformed into compliance with Mapbox GL.

---

# Updating the JavaScript File

Update the JavaScript file with the following three functions and a new version of the `map.on('load')` callback.

A description is located after this code block.

```javascript
// ...
// const callApiDatasetMetadata = async (uuid) => {
// ...


// declare a function that returns the Mapbox-ready raster tile URL template
// (example.com/{x}/{y}/{z}) from the response object returned by `callApiDatasetMetadata`
// takes one parameter
//   (obj) the API response data
// returns a string representing a templated URL, ready to be used by webmaps
const getTileLayerUrlForTreeCoverLoss = (obj) => {
    // drill down to get a useful object
    const layerConfig = obj['data']['attributes']['layer'][0]['attributes']['layerConfig'];
    // get the URL template parameters
    const defaultParams = layerConfig['params_config'];

    // get the full templated URL
    let url = layerConfig['source']['tiles'][0];
    // substitute default parameters iteratively
    for (const param of defaultParams) {
        url = url.replace('{' + param['key'] + '}', param['default'].toString());
    }
    return url;
}


// declare a function that can get a simple identifier for a layer
// takes one parameter
//   (obj) the API response data from `callApiDatasetMetadata`
// returns a string
const getLayerSlug = (obj) => {
    return obj['data']['attributes']['layer'][0]['attributes']['slug'];
}

// declare a function that can add a raster tile layer to a Mapbox map
// takes three parameters:
//   (mapVar) the Mapbox map object
//   (title) a string identifier for the source and layer
//   (url) the raster tile URL to add to the map
const addTileLayerToMap = (mapVar, title, url) => {
    // need to first add a source
    mapVar.addSource(title, {
        'type': 'raster',
        'tiles': [
            url
        ],
        'tilesize': 256
    });
    // then add the layer, referencing the source
    mapVar.addLayer({
        'id': title,
        'type': 'raster',
        'source': title,
        'paint': {
            'raster-opacity': 1  // let mapbox baselayer peak through
        }
    });
}


// ...
// var map = new mapboxgl.Map({
// ...


// run the API call once the map is loaded (API call is async)
map.on('load', async () => {
    // declare the Dataset ID
    const datasetId = 'b584954c-0d8d-40c6-859c-f3fdf3c2c5df';
    // fetch remote dataset metadata
    const metadata = await callApiDatasetMetadata(datasetId);
    // display the response metadata
    document.getElementById('metadata').textContent = JSON.stringify(metadata, null, 2);
    // get an identifier
    const slug = getLayerSlug(metadata);
    // get the tile layer URL from full API response data
    const tileLayerUrl = getTileLayerUrlForTreeCoverLoss(metadata);
    // add a layer to the map
    addTileLayerToMap(map, slug, tileLayerUrl);
});
```

---

# Summary of Changes

The changes above did the following:

* Added a function `getTileLayerUrlForTreeCoverLoss` to obtain a well-formed tile URL
* Added a function `getLayerSlug` to obtain a short identifier for the tile layer of interest
* Added a function `addTileLayerToMap` to handle the two-part source and layer definition process
* Updated the `map.on('load')` callback with more steps executed after the initial API call

---

Reload the browser again and you should now see the tile layer displayed on the map.

```
```
