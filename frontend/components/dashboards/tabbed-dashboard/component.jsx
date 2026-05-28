import PropTypes from 'prop-types';

// components
import StakeholdersTab from './tabs/stakeholders';
import MappingDataTab from './tabs/mapping-data';
import BarriersPoliciesTab from './tabs/barriers-policies';
import EAPInterventionsTab from './tabs/eap-interventions';

export default function TabbedDashboard() {
  return (
    <div className="c-report-dashboard">
      <div className="c-report-dashboard__header">
        <h1>Environmental Policy Analysis Report</h1>
        <p>Comprehensive overview of stakeholders, data mapping, policy barriers, and intervention strategies</p>
      </div>
      
      <div className="c-report-dashboard__content">
        <div className="c-report-section">
          <StakeholdersTab />
        </div>
        
        <div className="c-report-section">
          <MappingDataTab />
        </div>
        
        <div className="c-report-section">
          <BarriersPoliciesTab />
        </div>
        
        <div className="c-report-section">
          <EAPInterventionsTab />
        </div>
      </div>
    </div>
  );
}

TabbedDashboard.propTypes = {};

