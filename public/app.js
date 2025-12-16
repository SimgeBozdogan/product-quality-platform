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
    
    return `
    <div class="requirement-card">
      <h3>${req.title}</h3>
      <p>${req.description || ''}</p>
      ${req.user_story ? `<p><strong>User Story:</strong> ${req.user_story}</p>` : ''}
      ${req.acceptance_criteria ? `<p><strong>Acceptance Criteria:</strong><br>${req.acceptance_criteria.replace(/\n/g, '<br>')}</p>` : ''}
      <p class="test-count">Tests: ${testCount}</p>
      <div class="actions">
        <button class="btn-small btn-generate" onclick="generateTests(${req.id})">Generate Tests</button>
        <button class="btn-small btn-view-tests" onclick="showRequirementTests(${req.id})">View Tests</button>
        <button class="btn-small btn-assess" onclick="assessRisk(${req.id})">Assess Risk</button>
        <button class="btn-small btn-affected" onclick="showAffectedTests(${req.id})">Affected Tests</button>
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

async function displayTests(tests) {
  const container = document.getElementById('tests-list');
  
  for (let test of tests) {
    try {
      const flakyResponse = await fetch(`${API_URL}/tests/${test.id}/flaky-status`);
      test.flaky = await flakyResponse.json();
    } catch (error) {
      test.flaky = { is_flaky: false };
    }
  }
  
  container.innerHTML = tests.map(test => {
    const flakyBadge = test.flaky && test.flaky.is_flaky 
      ? '<span class="flaky-badge">FLAKY TEST</span>' 
      : '';
    
    const historyInfo = test.flaky && test.flaky.total_runs 
      ? `<p><strong>Last 5 runs:</strong> ${test.flaky.pass_count} passed, ${test.flaky.fail_count} failed</p>`
      : '';
    
    return `
    <div class="requirement-card">
      <h3>${test.title} ${flakyBadge}</h3>
      <p>${test.description || ''}</p>
      <p><strong>Type:</strong> ${test.type} | <strong>Status:</strong> ${test.status}</p>
      ${historyInfo}
      ${test.ai_generated ? '<span style="color: #3498db;">AI Generated</span>' : ''}
      <button class="btn-small btn-history" onclick="showTestHistory(${test.id})">View History</button>
    </div>
  `;
  }).join('');
}

async function showTestHistory(testId) {
  try {
    const response = await fetch(`${API_URL}/tests/${testId}/results`);
    const results = await response.json();
    
    const history = results.map((result, index) => 
      `${index + 1}. ${result.status.toUpperCase()} - ${new Date(result.created_at).toLocaleString()}`
    ).join('\n');
    
    alert(`Test execution history:\n\n${history || 'No test results yet'}`);
  } catch (error) {
    console.error('Error loading test history:', error);
    alert('Error loading test history');
  }
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

async function showRequirementTests(requirementId) {
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/tests`);
    const tests = await response.json();
    
    if (tests.length === 0) {
      alert('No tests linked to this requirement');
      return;
    }
    
    const testsList = tests.map(test => 
      `${test.title} [${test.status}] <button onclick="deleteTest(${test.id}, ${requirementId})">Delete</button>`
    ).join('\n');
    
    displayTests(tests);
    
    const container = document.getElementById('tests-list');
    if (container) {
      container.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (error) {
    console.error('Error loading requirement tests:', error);
    alert('Error loading tests');
  }
}

async function showAffectedTests(requirementId) {
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/affected-tests`);
    const data = await response.json();
    
    if (data.affected_tests && data.affected_tests.length > 0) {
      const testsList = data.affected_tests.map(test => `- ${test.title}`).join('\n');
      alert(`Tests that should be re-run after recent code changes:\n\n${testsList}`);
    } else {
      alert('No tests affected by recent code changes');
    }
  } catch (error) {
    console.error('Error loading affected tests:', error);
    alert('Error loading affected tests');
  }
}

async function deleteTest(testId, requirementId) {
  if (!confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/tests/${testId}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      alert('Test deleted successfully');
      loadRequirements();
    } else {
      alert('Error deleting test');
    }
  } catch (error) {
    console.error('Error deleting test:', error);
    alert('Error deleting test');
  }
}

async function loadReleaseChecklist(requirementId) {
  if (!requirementId) return;
  
  try {
    const response = await fetch(`${API_URL}/requirements/${requirementId}/release-checklist`);
    const checklist = await response.json();
    displayReleaseChecklist(checklist);
  } catch (error) {
    console.error('Error loading release checklist:', error);
  }
}

function displayReleaseChecklist(checklist) {
  const container = document.getElementById('checklist-results');
  const riskClass = `risk-${checklist.risk_level}`;
  
  container.innerHTML = `
    <div class="requirement-card">
      <h3>Release Checklist</h3>
      <div class="checklist-items">
        <div class="checklist-item ${checklist.checklist.failed_tests ? 'check-pass' : 'check-fail'}">
          ${checklist.checklist.failed_tests ? '✓' : '✗'} No failed tests
        </div>
        <div class="checklist-item ${checklist.checklist.new_api_changes ? 'check-pass' : 'check-fail'}">
          ${checklist.checklist.new_api_changes ? '✓' : '✗'} No new API changes
        </div>
        <div class="checklist-item ${checklist.checklist.new_feature ? 'check-pass' : 'check-fail'}">
          ${checklist.checklist.new_feature ? '✓' : '✗'} Not a new feature
        </div>
      </div>
      <p><strong>Risk Level:</strong> <span class="risk-badge ${riskClass}">${checklist.risk_level.toUpperCase()}</span></p>
      <p><strong>Recommendation:</strong> ${checklist.recommendation}</p>
    </div>
  `;
}

async function loadRequirementsForChecklist() {
  try {
    const response = await fetch(`${API_URL}/requirements`);
    const requirements = await response.json();
    const select = document.getElementById('requirement-select-checklist');
    if (select) {
      select.innerHTML = '<option value="">Select requirement...</option>' +
        requirements.map(req => `<option value="${req.id}">${req.title}</option>`).join('');
    }
  } catch (error) {
    console.error('Error loading requirements:', error);
  }
}

async function saveAPISnapshot() {
  const endpoint = document.getElementById('api-endpoint').value;
  const responseText = document.getElementById('api-response').value;
  
  if (!endpoint || !responseText) {
    alert('Please fill in both endpoint and response structure');
    return;
  }
  
  try {
    let responseStructure;
    try {
      responseStructure = JSON.parse(responseText);
    } catch (e) {
      alert('Invalid JSON format');
      return;
    }
    
    const response = await fetch(`${API_URL}/api-snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, response_structure: responseStructure })
    });
    
    const result = await response.json();
    const container = document.getElementById('api-warnings');
    
    if (result.warning) {
      container.innerHTML = `
        <div class="requirement-card" style="border-left: 4px solid #e74c3c;">
          <h3>⚠️ Breaking Changes Detected</h3>
          <p><strong>Removed fields:</strong> ${result.changes.removed_fields.join(', ') || 'None'}</p>
          <p><strong>Added fields:</strong> ${result.changes.added_fields.join(', ') || 'None'}</p>
          <p style="color: #e74c3c; font-weight: bold;">Frontend may break if these fields are used!</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="requirement-card" style="border-left: 4px solid #27ae60;">
          <p>✓ API snapshot saved. No breaking changes detected.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error saving API snapshot:', error);
    alert('Error saving API snapshot');
  }
}

loadRequirements();
loadRequirementsForChecklist();

