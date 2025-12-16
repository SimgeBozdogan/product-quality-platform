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

  db.run(`CREATE TABLE IF NOT EXISTS api_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    response_structure TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

app.get('/api/requirements/:id', (req, res) => {
  const requirementId = req.params.id;
  db.get('SELECT * FROM requirements WHERE id = ?', [requirementId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }
    res.json(row);
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

app.put('/api/requirements/:id', (req, res) => {
  const requirementId = req.params.id;
  const { title, description, user_story, acceptance_criteria } = req.body;
  db.run(
    'UPDATE requirements SET title = ?, description = ?, user_story = ?, acceptance_criteria = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [title, description, user_story, acceptance_criteria, requirementId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Requirement not found' });
        return;
      }
      res.json({ id: requirementId, title, description, user_story, acceptance_criteria });
    }
  );
});

app.delete('/api/requirements/:id', (req, res) => {
  const requirementId = req.params.id;
  
  db.run('DELETE FROM test_results WHERE test_id IN (SELECT id FROM tests WHERE requirement_id = ?)', [requirementId], (err1) => {
    if (err1) {
      res.status(500).json({ error: err1.message });
      return;
    }
    
    db.run('DELETE FROM tests WHERE requirement_id = ?', [requirementId], (err2) => {
      if (err2) {
        res.status(500).json({ error: err2.message });
        return;
      }
      
      db.run('DELETE FROM code_changes WHERE requirement_id = ?', [requirementId], (err3) => {
        if (err3) {
          res.status(500).json({ error: err3.message });
          return;
        }
        
        db.run('DELETE FROM release_assessments WHERE requirement_id = ?', [requirementId], (err4) => {
          if (err4) {
            res.status(500).json({ error: err4.message });
            return;
          }
          
          db.run('DELETE FROM requirements WHERE id = ?', [requirementId], function(err5) {
            if (err5) {
              res.status(500).json({ error: err5.message });
              return;
            }
            if (this.changes === 0) {
              res.status(404).json({ error: 'Requirement not found' });
              return;
            }
            res.json({ message: 'Requirement deleted successfully' });
          });
        });
      });
    });
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
  
  db.run('DELETE FROM test_results WHERE test_id IN (SELECT id FROM tests WHERE requirement_id = ? AND ai_generated = 1)', [requirementId], (deleteResultsErr) => {
    if (deleteResultsErr) {
      res.status(500).json({ error: deleteResultsErr.message });
      return;
    }
    
    db.run('DELETE FROM tests WHERE requirement_id = ? AND ai_generated = 1', [requirementId], (deleteErr) => {
      if (deleteErr) {
        res.status(500).json({ error: deleteErr.message });
        return;
      }
      
      db.get('SELECT * FROM requirements WHERE id = ?', [requirementId], (err, requirement) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        
        if (!requirement) {
          res.status(404).json({ error: 'Requirement not found' });
          return;
        }
        
        const aiTests = generateAITests(requirement);
        
        if (aiTests.length === 0) {
          res.json({ message: 'No tests generated', count: 0 });
          return;
        }
        
        const stmt = db.prepare('INSERT INTO tests (requirement_id, title, description, type, ai_generated) VALUES (?, ?, ?, ?, 1)');
        aiTests.forEach(test => {
          stmt.run([requirementId, test.title, test.description, test.type]);
        });
        stmt.finalize((finalizeErr) => {
          if (finalizeErr) {
            res.status(500).json({ error: finalizeErr.message });
            return;
          }
          res.json({ message: 'Tests generated', count: aiTests.length });
        });
      });
    });
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
    
    db.get('SELECT COUNT(*) as failed FROM tests t JOIN test_results tr ON t.id = tr.test_id WHERE t.requirement_id = ? AND tr.status = ?', 
      [requirementId, 'failed'], (err, failedCount) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        
        const total = testCount ? testCount.total : 0;
        const failed = failedCount ? failedCount.failed : 0;
        
        const riskLevel = calculateRiskLevel(total, failed);
        const recommendation = getRecommendation(riskLevel);
        
        res.json({
          risk_level: riskLevel,
          test_coverage: total,
          failed_tests: failed,
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
  
  if (!requirement) {
    return tests;
  }
  
  const title = requirement.title || 'Feature';
  const userStory = requirement.user_story || '';
  const description = requirement.description || '';
  const acceptanceCriteria = requirement.acceptance_criteria || '';
  
  if (userStory && userStory.trim()) {
    tests.push({
      title: `Test: ${title} - Happy Path`,
      description: `Verify that ${userStory.trim()} works as expected`,
      type: 'functional'
    });
    
    tests.push({
      title: `Test: ${title} - Error Handling`,
      description: `Verify error handling for ${userStory.trim()}`,
      type: 'negative'
    });
  }
  
  if (acceptanceCriteria && acceptanceCriteria.trim()) {
    const criteria = acceptanceCriteria.split('\n');
    criteria.forEach((criterion, index) => {
      const trimmedCriterion = criterion.trim();
      if (trimmedCriterion && trimmedCriterion.length > 0) {
        tests.push({
          title: `Test: ${title} - Acceptance Criterion ${index + 1}`,
          description: trimmedCriterion,
          type: 'acceptance'
        });
      }
    });
  } else if (description && description.trim()) {
    tests.push({
      title: `Test: ${title} - Basic Functionality`,
      description: `Verify basic functionality: ${description.trim()}`,
      type: 'functional'
    });
  }
  
  if (tests.length === 0) {
    tests.push({
      title: `Test: ${title} - Basic Test`,
      description: `Basic test for ${title}`,
      type: 'functional'
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

app.post('/api/api-snapshots', (req, res) => {
  const { endpoint, response_structure } = req.body;
  
  db.get('SELECT * FROM api_snapshots WHERE endpoint = ? ORDER BY created_at DESC LIMIT 1', 
    [endpoint], (err, previous) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      db.run('INSERT INTO api_snapshots (endpoint, response_structure) VALUES (?, ?)',
        [endpoint, JSON.stringify(response_structure)], function(insertErr) {
          if (insertErr) {
            res.status(500).json({ error: insertErr.message });
            return;
          }
          
          if (previous) {
            const previousStructure = JSON.parse(previous.response_structure);
            const changes = detectAPIChanges(previousStructure, response_structure);
            
            if (changes.has_breaking_changes) {
              res.json({
                id: this.lastID,
                warning: 'Breaking changes detected',
                changes: changes
              });
              return;
            }
          }
          
          res.json({ id: this.lastID, message: 'API snapshot saved' });
        });
    });
});

app.get('/api/api-snapshots/:endpoint/compare', (req, res) => {
  const endpoint = req.params.endpoint;
  
  db.all('SELECT * FROM api_snapshots WHERE endpoint = ? ORDER BY created_at DESC LIMIT 2',
    [endpoint], (err, snapshots) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      if (snapshots.length < 2) {
        res.json({ message: 'Not enough snapshots to compare' });
        return;
      }
      
      const previous = JSON.parse(snapshots[1].response_structure);
      const current = JSON.parse(snapshots[0].response_structure);
      const changes = detectAPIChanges(previous, current);
      
      res.json({
        has_changes: changes.has_breaking_changes,
        changes: changes
      });
    });
});

function detectAPIChanges(previous, current) {
  const removed = [];
  const added = [];
  
  if (typeof previous === 'object' && typeof current === 'object') {
    const prevKeys = Object.keys(previous);
    const currKeys = Object.keys(current);
    
    prevKeys.forEach(key => {
      if (!currKeys.includes(key)) {
        removed.push(key);
      }
    });
    
    currKeys.forEach(key => {
      if (!prevKeys.includes(key)) {
        added.push(key);
      }
    });
  }
  
  return {
    has_breaking_changes: removed.length > 0,
    removed_fields: removed,
    added_fields: added
  };
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

