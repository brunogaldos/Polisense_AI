import PropTypes from 'prop-types';

export default function BarriersPoliciesTab() {
  return (
    <div className="c-barriers-policies-tab">
      <div className="c-barriers-policies-tab__header">
        <h2>3. Barriers and Policies</h2>
        <p>Analysis of policy barriers and regulatory frameworks affecting environmental initiatives</p>
      </div>
      
      <div className="c-barriers-policies-tab__content">
        <div className="c-barriers-section">
          <h3>Key Barriers</h3>
          <div className="c-barriers-grid">
            <div className="c-barrier-card c-barrier-card--high">
              <h4>Regulatory Complexity</h4>
              <p>Multiple overlapping regulations create implementation challenges</p>
              <div className="c-barrier-metrics">
                <span className="c-metric">Impact: High</span>
                <span className="c-metric">Frequency: Common</span>
              </div>
            </div>
            
            <div className="c-barrier-card c-barrier-card--medium">
              <h4>Funding Constraints</h4>
              <p>Limited financial resources for environmental projects</p>
              <div className="c-barrier-metrics">
                <span className="c-metric">Impact: Medium</span>
                <span className="c-metric">Frequency: Frequent</span>
              </div>
            </div>
            
            <div className="c-barrier-card c-barrier-card--high">
              <h4>Technical Capacity</h4>
              <p>Lack of technical expertise in implementing solutions</p>
              <div className="c-barrier-metrics">
                <span className="c-metric">Impact: High</span>
                <span className="c-metric">Frequency: Common</span>
              </div>
            </div>
            
            <div className="c-barrier-card c-barrier-card--low">
              <h4>Stakeholder Coordination</h4>
              <p>Difficulties in aligning multiple stakeholder interests</p>
              <div className="c-barrier-metrics">
                <span className="c-metric">Impact: Low</span>
                <span className="c-metric">Frequency: Occasional</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="c-policies-section">
          <h3>Policy Framework</h3>
          <div className="c-policies-timeline">
            <div className="c-policy-item">
              <div className="c-policy-year">2020</div>
              <div className="c-policy-content">
                <h4>National Environmental Policy Act</h4>
                <p>Established comprehensive environmental protection framework</p>
              </div>
            </div>
            
            <div className="c-policy-item">
              <div className="c-policy-year">2021</div>
              <div className="c-policy-content">
                <h4>Climate Action Plan</h4>
                <p>Set targets for carbon reduction and renewable energy adoption</p>
              </div>
            </div>
            
            <div className="c-policy-item">
              <div className="c-policy-year">2022</div>
              <div className="c-policy-content">
                <h4>Green Infrastructure Initiative</h4>
                <p>Promoted nature-based solutions for urban development</p>
              </div>
            </div>
            
            <div className="c-policy-item">
              <div className="c-policy-year">2023</div>
              <div className="c-policy-content">
                <h4>Circular Economy Regulations</h4>
                <p>Implemented waste reduction and resource efficiency measures</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="c-recommendations-section">
          <h3>Policy Recommendations</h3>
          <div className="c-recommendations-list">
            <div className="c-recommendation">
              <h4>Streamline Regulatory Processes</h4>
              <p>Consolidate overlapping regulations and create unified approval processes</p>
            </div>
            <div className="c-recommendation">
              <h4>Increase Funding Mechanisms</h4>
              <p>Establish dedicated funding streams for environmental initiatives</p>
            </div>
            <div className="c-recommendation">
              <h4>Capacity Building Programs</h4>
              <p>Invest in training and technical assistance for implementation teams</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

BarriersPoliciesTab.propTypes = {};

