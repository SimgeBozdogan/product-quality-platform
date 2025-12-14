const API_URL = 'http://localhost:3000/api';

function showRequirementForm() {
  document.getElementById('requirement-form').style.display = 'flex';
}

function hideRequirementForm() {
  document.getElementById('requirement-form').style.display = 'none';
}

async function loadRequirements() {
  try {
    const response = await fetch(`${API_URL}/requirements`);
    const requirements = await response.json();
    
    for (let req of requirements) {
      const testsResponse = await fetch(`${API_URL}/requirements/${req.id}/tests`);
      req.tests = await testsResponse.json();
    }
    
    displayRequirements(requirements);
  } catch (error) {
    console.error('Error loading requirements:', error);
  }
}

function displayRequirements(requirements) {
  const container = document.getElementById('requirements-list');
  container.innerHTML = requirements.map(req => {
    const testCount = req.tests ? req.tests.length : 0;
    const testsList = req.tests && req.tests.length > 0 
      ? `<div class="tests-list">
           <strong>Linked Tests (${testCount}):</strong>
           <ul>
             ${req.tests.map(test => `
               <li>
                 ${test.title}
                 <button class="btn-delete-test" onclick="deleteTest(${test.id}, ${req.id})" title="Delete test">×</button>
               </li>
             `).join('')}
           </ul>
         </div>`
      : '<p class="no-tests">No tests linked to this requirement</p>';
    
    return `
    <div class="requirement-card">
      <h3>${req.title}</h3>
      <p>${req.description || ''}</p>
      ${req.user_story ? `<p><strong>User Story:</strong> ${req.user_story}</p>` : ''}
      ${req.acceptance_criteria ? `<p><strong>Acceptance Criteria:</strong><br>${req.acceptance_criteria.replace(/\n/g, '<br>')}</p>` : ''}
      ${testsList}
      <div class="actions">
        <button class="btn-small btn-generate" onclick="generateTests(${req.id})">Generate Tests</button>
        <button class="btn-small btn-assess" onclick="assessRisk(${req.id})">Assess Risk</button>
      </div>
    </div>
  `;
  }).join('');
}

async function addRequirement(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const data = {
    title: formData.get('title'),
    description: formData.get('description'),
    user_story: formData.get('user_story'),
    acceptance_criteria: formData.get('acceptance_criteria')
  };

  try {
    const response = await fetch(`${API_URL}/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (response.ok) {
      hideRequirementForm();
      event.target.reset();
      loadRequirements();
    }
  } catch (error) {
    console.error('Error adding requirement:', error);
  }
}

async function generateTests(requirementId) {
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/generate-tests`, {
      method: 'POST'
    });
    const result = await response.json();
    alert(`Generated ${result.count} test scenarios`);
    loadTests(requirementId);
  } catch (error) {
    console.error('Error generating tests:', error);
  }
}

async function loadTests(requirementId) {
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/tests`);
    const tests = await response.json();
    displayTests(tests);
  } catch (error) {
    console.error('Error loading tests:', error);
  }
}

function displayTests(tests) {
  const container = document.getElementById('tests-list');
  container.innerHTML = tests.map(test => `
    <div class="requirement-card">
      <h3>${test.title}</h3>
      <p>${test.description || ''}</p>
      <p><strong>Type:</strong> ${test.type} | <strong>Status:</strong> ${test.status}</p>
      ${test.ai_generated ? '<span style="color: #3498db;">AI Generated</span>' : ''}
    </div>
  `).join('');
}

async function assessRisk(requirementId) {
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/risk-assessment`);
    const assessment = await response.json();
    displayAssessment(assessment);
  } catch (error) {
    console.error('Error assessing risk:', error);
  }
}

function displayAssessment(assessment) {
  const container = document.getElementById('assessments-list');
  const riskClass = `risk-${assessment.risk_level}`;
  container.innerHTML = `
    <div class="requirement-card">
      <h3>Risk Assessment</h3>
      <p><strong>Risk Level:</strong> <span class="risk-badge ${riskClass}">${assessment.risk_level.toUpperCase()}</span></p>
      <p><strong>Test Coverage:</strong> ${assessment.test_coverage} tests</p>
      <p><strong>Failed Tests:</strong> ${assessment.failed_tests}</p>
      <p><strong>Recommendation:</strong> ${assessment.recommendation}</p>
    </div>
  `;
}

loadRequirements();

