/**
 * Dashboard Generator Utility
 * Converts chatbot text responses into structured dashboard components
 */

/**
 * Extract tables from text using regex patterns
 */
export const extractTables = (text) => {
  const tables = [];
  
  // Pattern for markdown-style tables
  const markdownTableRegex = /(\|.*\|[\r\n]+)+/g;
  const markdownMatches = text.match(markdownTableRegex);
  
  if (markdownMatches) {
    markdownMatches.forEach(tableText => {
      const rows = tableText.trim().split('\n').filter(row => row.trim());
      if (rows.length > 1) {
        const headers = rows[0].split('|').map(h => h.trim()).filter(h => h);
        const data = rows.slice(1).map(row => 
          row.split('|').map(cell => cell.trim()).filter(cell => cell)
        );
        
        if (headers.length > 0 && data.length > 0) {
          tables.push({
            type: 'table',
            headers,
            data,
            title: 'Data Table'
          });
        }
      }
    });
  }
  
  // Pattern for structured data (key: value pairs)
  const keyValueRegex = /([A-Za-z\s]+):\s*([^\n\r]+)/g;
  const keyValueMatches = [...text.matchAll(keyValueRegex)];
  
  if (keyValueMatches.length > 0) {
    const keyValueData = keyValueMatches.map(match => ({
      key: match[1].trim(),
      value: match[2].trim()
    }));
    
    tables.push({
      type: 'keyvalue',
      data: keyValueData,
      title: 'Key Information'
    });
  }
  
  return tables;
};

/**
 * Extract lists from text
 */
export const extractLists = (text) => {
  const lists = [];
  
  // Pattern for bullet points
  const bulletRegex = /^[\s]*[-•*]\s*(.+)$/gm;
  const bulletMatches = [...text.matchAll(bulletRegex)];
  
  if (bulletMatches.length > 0) {
    lists.push({
      type: 'bullet',
      items: bulletMatches.map(match => match[1].trim()),
      title: 'Key Points'
    });
  }
  
  // Pattern for numbered lists
  const numberedRegex = /^[\s]*\d+\.\s*(.+)$/gm;
  const numberedMatches = [...text.matchAll(numberedRegex)];
  
  if (numberedMatches.length > 0) {
    lists.push({
      type: 'numbered',
      items: numberedMatches.map(match => match[1].trim()),
      title: 'Steps/Process'
    });
  }
  
  return lists;
};

/**
 * Extract stakeholders from text
 */
export const extractStakeholders = (text) => {
  const stakeholders = [];
  
  // Common stakeholder patterns
  const stakeholderPatterns = [
    /(?:stakeholder|organization|institution|agency|ministry|department|company|NGO|government|private sector|public sector)[\s\w]*:?\s*([^\n\r]+)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:is|are|represents?|represents?|manages?|oversees?|responsible for)/gi
  ];
  
  stakeholderPatterns.forEach(pattern => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const stakeholder = match[1]?.trim();
      if (stakeholder && stakeholder.length > 3) {
        stakeholders.push({
          name: stakeholder,
          role: 'Stakeholder',
          contact: 'Not specified',
          influence: 'Medium'
        });
      }
    });
  });
  
  return stakeholders;
};

/**
 * Extract policies and barriers from text
 */
export const extractPoliciesAndBarriers = (text) => {
  const policies = [];
  const barriers = [];
  
  // Policy patterns
  const policyPatterns = [
    /(?:policy|regulation|law|act|framework|guideline|standard)[\s\w]*:?\s*([^\n\r]+)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:policy|regulation|law)/gi
  ];
  
  policyPatterns.forEach(pattern => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const policy = match[1]?.trim();
      if (policy && policy.length > 5) {
        policies.push({
          name: policy,
          type: 'Policy/Regulation',
          status: 'Active',
          impact: 'Medium'
        });
      }
    });
  });
  
  // Barrier patterns
  const barrierPatterns = [
    /(?:barrier|challenge|obstacle|limitation|constraint|difficulty)[\s\w]*:?\s*([^\n\r]+)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:barrier|challenge|obstacle)/gi
  ];
  
  barrierPatterns.forEach(pattern => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const barrier = match[1]?.trim();
      if (barrier && barrier.length > 5) {
        barriers.push({
          name: barrier,
          type: 'Barrier',
          severity: 'Medium',
          category: 'Implementation'
        });
      }
    });
  });
  
  return { policies, barriers };
};

/**
 * Extract interventions from text
 */
export const extractInterventions = (text) => {
  const interventions = [];
  
  const interventionPatterns = [
    /(?:intervention|solution|recommendation|action|measure|strategy|initiative)[\s\w]*:?\s*([^\n\r]+)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:intervention|solution|recommendation)/gi
  ];
  
  interventionPatterns.forEach(pattern => {
    const matches = [...text.matchAll(pattern)];
    matches.forEach(match => {
      const intervention = match[1]?.trim();
      if (intervention && intervention.length > 5) {
        interventions.push({
          name: intervention,
          type: 'Intervention',
          priority: 'Medium',
          timeline: 'Short-term',
          cost: 'Medium'
        });
      }
    });
  });
  
  return interventions;
};

/**
 * Template matching for common response patterns
 */
export const matchTemplate = (text) => {
  const templates = {
    'stakeholder_analysis': {
      pattern: /stakeholder|organization|institution|agency|ministry|department|company|NGO|government|private sector|public sector/i,
      component: 'StakeholderTable',
      priority: 1
    },
    'policy_review': {
      pattern: /policy|regulation|law|act|framework|guideline|standard|barrier|challenge|obstacle/i,
      component: 'PolicyTimeline',
      priority: 2
    },
    'intervention_plan': {
      pattern: /intervention|solution|recommendation|action|measure|strategy|initiative|implementation/i,
      component: 'InterventionMatrix',
      priority: 3
    },
    'data_mapping': {
      pattern: /data|dataset|indicator|metric|measurement|statistics|analysis|mapping/i,
      component: 'DataMapping',
      priority: 4
    }
  };
  
  const matches = [];
  
  Object.entries(templates).forEach(([key, template]) => {
    if (template.pattern.test(text)) {
      matches.push({ key, ...template });
    }
  });
  
  // Return the highest priority match
  if (matches.length > 0) {
    matches.sort((a, b) => a.priority - b.priority);
    return matches[0];
  }
  
  return { key: 'generic', component: 'GenericDashboard', priority: 999 };
};

/**
 * Main function to parse chatbot response and generate dashboard structure
 */
export const parseChatbotResponse = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      type: 'error',
      message: 'Invalid response text'
    };
  }
  
  try {
    // Extract different types of data
    const tables = extractTables(text);
    const lists = extractLists(text);
    const stakeholders = extractStakeholders(text);
    const { policies, barriers } = extractPoliciesAndBarriers(text);
    const interventions = extractInterventions(text);
    
    // Match template
    const template = matchTemplate(text);
    
    // Generate dashboard structure
    const dashboardData = {
      type: 'dashboard',
      template: template.key,
      title: 'Policy Analysis Dashboard',
      subtitle: 'Generated from AI Research Response',
      sections: []
    };
    
    // Add stakeholders section if found
    if (stakeholders.length > 0) {
      dashboardData.sections.push({
        id: 'stakeholders',
        title: 'Stakeholders',
        type: 'stakeholder_table',
        data: stakeholders
      });
    }
    
    // Add policies and barriers section
    if (policies.length > 0 || barriers.length > 0) {
      dashboardData.sections.push({
        id: 'policies_barriers',
        title: 'Policies & Barriers',
        type: 'policy_timeline',
        data: {
          policies,
          barriers
        }
      });
    }
    
    // Add interventions section
    if (interventions.length > 0) {
      dashboardData.sections.push({
        id: 'interventions',
        title: 'EAP Interventions',
        type: 'intervention_matrix',
        data: interventions
      });
    }
    
    // Add data mapping section if tables found
    if (tables.length > 0) {
      dashboardData.sections.push({
        id: 'data_mapping',
        title: 'Data Mapping',
        type: 'data_table',
        data: tables
      });
    }
    
    // Add key points section if lists found
    if (lists.length > 0) {
      dashboardData.sections.push({
        id: 'key_points',
        title: 'Key Points',
        type: 'bullet_list',
        data: lists
      });
    }
    
    // If no specific sections found, create a generic text section
    if (dashboardData.sections.length === 0) {
      dashboardData.sections.push({
        id: 'text_content',
        title: 'Research Summary',
        type: 'text_content',
        data: {
          content: text,
          wordCount: text.split(' ').length
        }
      });
    }
    
    return dashboardData;
    
  } catch (error) {
    console.error('Error parsing chatbot response:', error);
    return {
      type: 'error',
      message: 'Failed to parse response',
      error: error.message
    };
  }
};

/**
 * Generate dashboard components from parsed data
 */
export const generateDashboardComponents = (dashboardData) => {
  if (dashboardData.type === 'error') {
    return {
      type: 'error',
      message: dashboardData.message
    };
  }
  
  return {
    type: 'success',
    dashboard: dashboardData,
    components: dashboardData.sections.map(section => ({
      id: section.id,
      title: section.title,
      type: section.type,
      data: section.data
    }))
  };
};
