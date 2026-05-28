import PropTypes from 'prop-types';

// Dummy data for stakeholders table
const STAKEHOLDERS_DATA = [
  {
    id: 1,
    stakeholder: 'Ministry of Environment',
    type: 'National',
    power: 'High Powers',
    interest: 'Environmental Policy',
    contact: 'env@ministry.gov',
    role: 'Policy Maker',
  },
  {
    id: 2,
    stakeholder: 'Regional Development Agency',
    type: 'Regional',
    power: 'Shared Powers',
    interest: 'Economic Development',
    contact: 'info@regional-dev.org',
    role: 'Implementation Partner',
  },
  {
    id: 3,
    stakeholder: 'Local Municipality',
    type: 'Local Government',
    power: 'Shared Powers',
    interest: 'Urban Planning',
    contact: 'planning@city.gov',
    role: 'Local Authority',
  },
  {
    id: 4,
    stakeholder: 'Community Environmental Group',
    type: 'Community',
    power: 'No Powers, High Interest',
    interest: 'Environmental Protection',
    contact: 'contact@envgroup.org',
    role: 'Advocacy',
  },
  {
    id: 5,
    stakeholder: 'GreenTech Solutions Inc.',
    type: 'Private',
    power: 'High Powers',
    interest: 'Clean Technology',
    contact: 'business@greentech.com',
    role: 'Technology Provider',
  },
  {
    id: 6,
    stakeholder: 'University Research Center',
    type: 'National',
    power: 'Shared Powers',
    interest: 'Research & Development',
    contact: 'research@university.edu',
    role: 'Knowledge Provider',
  },
  {
    id: 7,
    stakeholder: 'International NGO',
    type: 'National',
    power: 'Shared Powers',
    interest: 'Climate Action',
    contact: 'programs@ngo.org',
    role: 'Implementation Support',
  },
  {
    id: 8,
    stakeholder: 'Local Business Association',
    type: 'Private',
    power: 'No Powers, High Interest',
    interest: 'Business Development',
    contact: 'info@business-assoc.org',
    role: 'Industry Representative',
  },
];

export default function StakeholdersTab() {
  return (
    <div className="c-stakeholders-tab">
      <div className="c-stakeholders-tab__header">
        <h2>1. Stakeholder Analysis Matrix</h2>
        <p>Comprehensive overview of key stakeholders involved in environmental policy implementation</p>
      </div>
      
      <div className="c-stakeholders-tab__table-container">
        <table className="c-stakeholders-table">
          <thead>
            <tr>
              <th>Stakeholder</th>
              <th>Type</th>
              <th>Power Level</th>
              <th>Interest Area</th>
              <th>Contact</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {STAKEHOLDERS_DATA.map((stakeholder) => (
              <tr key={stakeholder.id}>
                <td className="c-stakeholders-table__stakeholder">
                  <strong>{stakeholder.stakeholder}</strong>
                </td>
                <td className="c-stakeholders-table__type">
                  <span className={`c-tag c-tag--${stakeholder.type.toLowerCase().replace(' ', '-')}`}>
                    {stakeholder.type}
                  </span>
                </td>
                <td className="c-stakeholders-table__power">
                  <span className={`c-power-indicator c-power-indicator--${stakeholder.power.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                    {stakeholder.power}
                  </span>
                </td>
                <td className="c-stakeholders-table__interest">
                  {stakeholder.interest}
                </td>
                <td className="c-stakeholders-table__contact">
                  <a href={`mailto:${stakeholder.contact}`}>
                    {stakeholder.contact}
                  </a>
                </td>
                <td className="c-stakeholders-table__role">
                  {stakeholder.role}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="c-stakeholders-tab__summary">
        <div className="c-summary-cards">
          <div className="c-summary-card">
            <h3>High Power Stakeholders</h3>
            <p>2 organizations with significant influence over policy decisions</p>
          </div>
          <div className="c-summary-card">
            <h3>Shared Power Stakeholders</h3>
            <p>4 organizations with collaborative decision-making authority</p>
          </div>
          <div className="c-summary-card">
            <h3>High Interest Stakeholders</h3>
            <p>2 organizations with strong engagement but limited formal power</p>
          </div>
        </div>
      </div>
    </div>
  );
}

StakeholdersTab.propTypes = {};

