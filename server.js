const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    user_story TEXT,
    acceptance_criteria TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT,
    status TEXT DEFAULT 'pending',
    ai_generated INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requirement_id) REFERENCES requirements(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS code_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER,
    file_path TEXT,
    change_type TEXT,
    description TEXT,
    commit_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requirement_id) REFERENCES requirements(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER,
    status TEXT,
    log_output TEXT,
    error_message TEXT,
    execution_time INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_id) REFERENCES tests(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS release_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER,
    risk_level TEXT,
    test_coverage REAL,
    business_impact TEXT,
    recommendation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requirement_id) REFERENCES requirements(id)
  )`);
});

app.get('/api/requirements', (req, res) => {
  db.all('SELECT * FROM requirements ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/requirements', (req, res) => {
  const { title, description, user_story, acceptance_criteria } = req.body;
  db.run(
    'INSERT INTO requirements (title, description, user_story, acceptance_criteria) VALUES (?, ?, ?, ?)',
    [title, description, user_story, acceptance_criteria],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, title, description, user_story, acceptance_criteria });
    }
  );
});

app.get('/api/requirements/:id/tests', (req, res) => {
  const requirementId = req.params.id;
  db.all('SELECT * FROM tests WHERE requirement_id = ? ORDER BY created_at DESC', [requirementId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.delete('/api/tests/:id', (req, res) => {
  const testId = req.params.id;
  db.run('DELETE FROM tests WHERE id = ?', [testId], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Test deleted successfully', id: testId });
  });
});

app.post('/api/requirements/:id/generate-tests', (req, res) => {
  const requirementId = req.params.id;
  db.get('SELECT * FROM requirements WHERE id = ?', [requirementId], (err, req) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    const aiTests = generateAITests(req);
    
    const stmt = db.prepare('INSERT INTO tests (requirement_id, title, description, type, ai_generated) VALUES (?, ?, ?, ?, 1)');
    aiTests.forEach(test => {
      stmt.run([requirementId, test.title, test.description, test.type]);
    });
    stmt.finalize();
    
    res.json({ message: 'Tests generated', count: aiTests.length });
  });
});

app.get('/api/tests/:id/results', (req, res) => {
  const testId = req.params.id;
  db.all('SELECT * FROM test_results WHERE test_id = ? ORDER BY created_at DESC LIMIT 10', [testId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.get('/api/tests/:id/flaky-status', (req, res) => {
  const testId = req.params.id;
  
  db.all(`
    SELECT status 
    FROM test_results 
    WHERE test_id = ? 
    ORDER BY created_at DESC 
    LIMIT 5
  `, [testId], (err, results) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (results.length < 2) {
      res.json({ is_flaky: false, reason: 'Not enough test runs' });
      return;
    }
    
    const passCount = results.filter(r => r.status === 'passed').length;
    const failCount = results.filter(r => r.status === 'failed').length;
    
    const isFlaky = (passCount > 0 && failCount > 0) && results.length >= 3;
    
    res.json({
      is_flaky: isFlaky,
      pass_count: passCount,
      fail_count: failCount,
      total_runs: results.length
    });
  });
});

app.post('/api/code-changes', (req, res) => {
  const { requirement_id, file_path, change_type, description, commit_hash } = req.body;
  db.run(
    'INSERT INTO code_changes (requirement_id, file_path, change_type, description, commit_hash) VALUES (?, ?, ?, ?, ?)',
    [requirement_id, file_path, change_type, description, commit_hash],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      analyzeImpact(requirement_id, file_path, change_type).then(impact => {
        res.json({ id: this.lastID, impact });
      });
    }
  );
});

app.get('/api/requirements/:id/affected-tests', (req, res) => {
  const requirementId = req.params.id;
  
  db.all(`
    SELECT DISTINCT t.* 
    FROM tests t
    JOIN code_changes cc ON t.requirement_id = cc.requirement_id
    WHERE cc.requirement_id = ?
    AND cc.created_at > datetime('now', '-7 days')
    ORDER BY t.created_at DESC
  `, [requirementId], (err, tests) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ affected_tests: tests });
  });
});

app.get('/api/requirements/:id/risk-assessment', (req, res) => {
  const requirementId = req.params.id;
  
  db.get('SELECT COUNT(*) as total FROM tests WHERE requirement_id = ?', [requirementId], (err, testCount) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    db.get('SELECT COUNT(*) as failed FROM tests t JOIN test_results tr ON t.id = tr.test_id WHERE t.requirement_id = ? AND tr.status = "failed"', 
      [requirementId], (err, failedCount) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        
        const riskLevel = calculateRiskLevel(testCount.total, failedCount.failed);
        const recommendation = getRecommendation(riskLevel);
        
        res.json({
          risk_level: riskLevel,
          test_coverage: testCount.total,
          failed_tests: failedCount.failed,
          recommendation: recommendation
        });
      });
  });
});

app.get('/api/requirements/:id/release-checklist', (req, res) => {
  const requirementId = req.params.id;
  
  db.get('SELECT COUNT(*) as failed FROM tests t JOIN test_results tr ON t.id = tr.test_id WHERE t.requirement_id = ? AND tr.status = "failed"', 
    [requirementId], (err, failedTests) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      db.get('SELECT COUNT(*) as changes FROM code_changes WHERE requirement_id = ? AND created_at > datetime("now", "-7 days")', 
        [requirementId], (err, newChanges) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          
          db.get('SELECT status FROM requirements WHERE id = ?', [requirementId], (err, req) => {
            if (err) {
              res.status(500).json({ error: err.message });
              return;
            }
            
            const hasFailedTests = failedTests.failed > 0;
            const hasRecentChanges = newChanges.changes > 0;
            const isNewFeature = req.status === 'new' || req.status === 'draft';
            
            const allPassed = !hasFailedTests && !hasRecentChanges;
            const riskLevel = allPassed ? 'low' : (hasFailedTests ? 'high' : 'medium');
            
            res.json({
              checklist: {
                failed_tests: !hasFailedTests,
                new_api_changes: !hasRecentChanges,
                new_feature: !isNewFeature
              },
              risk_level: riskLevel,
              recommendation: riskLevel === 'low' ? 'This release is acceptable' : 'This release is risky'
            });
          });
        });
    });
});

function generateAITests(requirement) {
  const tests = [];
  
  if (requirement.user_story) {
    tests.push({
      title: `Test: ${requirement.title} - Happy Path`,
      description: `Verify that ${requirement.user_story} works as expected`,
      type: 'functional'
    });
    
    tests.push({
      title: `Test: ${requirement.title} - Error Handling`,
      description: `Verify error handling for ${requirement.user_story}`,
      type: 'negative'
    });
  }
  
  if (requirement.acceptance_criteria) {
    const criteria = requirement.acceptance_criteria.split('\n');
    criteria.forEach((criterion, index) => {
      if (criterion.trim()) {
        tests.push({
          title: `Test: ${requirement.title} - Acceptance Criterion ${index + 1}`,
          description: criterion.trim(),
          type: 'acceptance'
        });
      }
    });
  }
  
  return tests;
}

function calculateRiskLevel(totalTests, failedTests) {
  if (totalTests === 0) return 'high';
  const failureRate = failedTests / totalTests;
  if (failureRate > 0.3) return 'high';
  if (failureRate > 0.1) return 'medium';
  return 'low';
}

function getRecommendation(riskLevel) {
  const recommendations = {
    high: 'Do not release. High risk of failure. Review and fix failing tests.',
    medium: 'Release with caution. Some tests are failing. Monitor closely after release.',
    low: 'Safe to release. Test coverage is good and failure rate is low.'
  };
  return recommendations[riskLevel] || 'Unable to assess risk.';
}

async function analyzeImpact(requirementId, filePath, changeType) {
  return {
    affected_tests: [],
    risk_areas: [filePath],
    recommendation: 'Review related tests'
  };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

