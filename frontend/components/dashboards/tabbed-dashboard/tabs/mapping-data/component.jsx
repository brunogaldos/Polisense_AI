import PropTypes from 'prop-types';

export default function MappingDataTab() {
  return (
    <div className="c-mapping-data-tab">
      <div className="c-mapping-data-tab__header">
        <h2>2. Mapping Data</h2>
        <p>Geospatial data and mapping resources for environmental analysis</p>
      </div>
      
      <div className="c-mapping-data-tab__content">
        <div className="c-data-categories">
          <div className="c-data-category">
            <h3>Satellite Imagery</h3>
            <ul>
              <li>Landsat 8/9 imagery (30m resolution)</li>
              <li>Sentinel-2 data (10m resolution)</li>
              <li>MODIS vegetation indices</li>
              <li>Nighttime lights data</li>
            </ul>
          </div>
          
          <div className="c-data-category">
            <h3>Environmental Layers</h3>
            <ul>
              <li>Land use/land cover classification</li>
              <li>Forest cover and deforestation</li>
              <li>Water bodies and wetlands</li>
              <li>Protected areas boundaries</li>
            </ul>
          </div>
          
          <div className="c-data-category">
            <h3>Climate Data</h3>
            <ul>
              <li>Temperature and precipitation</li>
              <li>Climate change projections</li>
              <li>Drought and flood risk maps</li>
              <li>Carbon sequestration potential</li>
            </ul>
          </div>
          
          <div className="c-data-category">
            <h3>Socioeconomic Data</h3>
            <ul>
              <li>Population density</li>
              <li>Economic activity indicators</li>
              <li>Infrastructure networks</li>
              <li>Vulnerability assessments</li>
            </ul>
          </div>
        </div>
        
        <div className="c-mapping-tools">
          <h3>Available Mapping Tools</h3>
          <div className="c-tools-grid">
            <div className="c-tool-card">
              <h4>Interactive Web Map</h4>
              <p>Real-time visualization of environmental data layers</p>
              <button className="c-button c-button--primary">Launch Map</button>
            </div>
            <div className="c-tool-card">
              <h4>Data Download Portal</h4>
              <p>Access to raw geospatial datasets</p>
              <button className="c-button c-button--secondary">Download Data</button>
            </div>
            <div className="c-tool-card">
              <h4>Analysis Dashboard</h4>
              <p>Statistical analysis and trend visualization</p>
              <button className="c-button c-button--secondary">View Analytics</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

MappingDataTab.propTypes = {};

