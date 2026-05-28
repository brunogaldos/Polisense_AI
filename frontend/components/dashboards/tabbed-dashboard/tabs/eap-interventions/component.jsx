import PropTypes from 'prop-types';

export default function EAPInterventionsTab() {
  return (
    <div className="c-eap-interventions-tab">
      <div className="c-eap-interventions-tab__header">
        <h2>4. EAP Interventions</h2>
        <p>Environmental Action Plan interventions and implementation strategies</p>
      </div>
      
      <div className="c-eap-interventions-tab__content">
        <div className="c-interventions-overview">
          <div className="c-overview-stats">
            <div className="c-stat-card">
              <h3>24</h3>
              <p>Active Interventions</p>
            </div>
            <div className="c-stat-card">
              <h3>18</h3>
              <p>Completed Projects</p>
            </div>
            <div className="c-stat-card">
              <h3>85%</h3>
              <p>Success Rate</p>
            </div>
            <div className="c-stat-card">
              <h3>$2.4M</h3>
              <p>Total Investment</p>
            </div>
          </div>
        </div>
        
        <div className="c-interventions-categories">
          <div className="c-category-section">
            <h3>Climate Mitigation</h3>
            <div className="c-intervention-list">
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Renewable Energy Deployment</h4>
                  <span className="c-status c-status--active">Active</span>
                </div>
                <p>Installation of solar and wind energy systems across 15 municipalities</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 65%</span>
                  <span className="c-metric">Budget: $800K</span>
                  <span className="c-metric">Timeline: 18 months</span>
                </div>
              </div>
              
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Energy Efficiency Program</h4>
                  <span className="c-status c-status--completed">Completed</span>
                </div>
                <p>Retrofitting of public buildings with energy-efficient technologies</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 100%</span>
                  <span className="c-metric">Budget: $450K</span>
                  <span className="c-metric">Savings: 30% energy reduction</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="c-category-section">
            <h3>Ecosystem Protection</h3>
            <div className="c-intervention-list">
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Forest Restoration Initiative</h4>
                  <span className="c-status c-status--active">Active</span>
                </div>
                <p>Reforestation and forest management in degraded areas</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 40%</span>
                  <span className="c-metric">Budget: $600K</span>
                  <span className="c-metric">Area: 500 hectares</span>
                </div>
              </div>
              
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Wetland Conservation</h4>
                  <span className="c-status c-status--planning">Planning</span>
                </div>
                <p>Protection and restoration of critical wetland ecosystems</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 15%</span>
                  <span className="c-metric">Budget: $300K</span>
                  <span className="c-metric">Start: Q2 2024</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="c-category-section">
            <h3>Community Engagement</h3>
            <div className="c-intervention-list">
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Environmental Education Program</h4>
                  <span className="c-status c-status--active">Active</span>
                </div>
                <p>Community workshops and school programs on environmental awareness</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 75%</span>
                  <span className="c-metric">Budget: $150K</span>
                  <span className="c-metric">Participants: 2,500</span>
                </div>
              </div>
              
              <div className="c-intervention-item">
                <div className="c-intervention-header">
                  <h4>Green Jobs Initiative</h4>
                  <span className="c-status c-status--completed">Completed</span>
                </div>
                <p>Training programs for green economy employment opportunities</p>
                <div className="c-intervention-metrics">
                  <span className="c-metric">Progress: 100%</span>
                  <span className="c-metric">Budget: $200K</span>
                  <span className="c-metric">Jobs Created: 150</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="c-interventions-timeline">
          <h3>Implementation Timeline</h3>
          <div className="c-timeline">
            <div className="c-timeline-item">
              <div className="c-timeline-date">Q1 2024</div>
              <div className="c-timeline-content">
                <h4>Project Initiation</h4>
                <p>Launch of renewable energy and forest restoration programs</p>
              </div>
            </div>
            <div className="c-timeline-item">
              <div className="c-timeline-date">Q2 2024</div>
              <div className="c-timeline-content">
                <h4>Mid-term Review</h4>
                <p>Assessment of progress and adjustment of strategies</p>
              </div>
            </div>
            <div className="c-timeline-item">
              <div className="c-timeline-date">Q3 2024</div>
              <div className="c-timeline-content">
                <h4>Scale-up Phase</h4>
                <p>Expansion of successful interventions to additional areas</p>
              </div>
            </div>
            <div className="c-timeline-item">
              <div className="c-timeline-date">Q4 2024</div>
              <div className="c-timeline-content">
                <h4>Evaluation & Planning</h4>
                <p>Final assessment and planning for next phase</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

EAPInterventionsTab.propTypes = {};

