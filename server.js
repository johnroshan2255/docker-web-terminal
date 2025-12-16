const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const cors = require('cors');
const pty = require('node-pty');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Available routes:');
  console.log('  DELETE /api/container/:identifier');
  console.log('  GET /api/container/:identifier');
  console.log('  POST /api/create-container');
});

const wss = new WebSocket.Server({ server });

let containerId = null;

// Create Docker container with streaming logs
app.post('/api/create-container', (req, res) => {
  const { image = 'ubuntu:latest' } = req.body;
  const containerName = `svelte-terminal-${Date.now()}`;
  
  // First, pull the image if needed (this will show progress)
  const pullProc = spawn('docker', ['pull', image]);
  
  let pullOutput = '';
  pullProc.stdout.on('data', (data) => {
    pullOutput += data.toString();
    // Stream pull progress could be sent via WebSocket if needed
  });
  
  pullProc.stderr.on('data', (data) => {
    pullOutput += data.toString();
  });
  
  pullProc.on('close', (pullCode) => {
    // Now create the container
    const runProc = spawn('docker', ['run', '-dit', '--name', containerName, image, '/bin/bash']);
    
    let runOutput = '';
    runProc.stdout.on('data', (data) => runOutput += data.toString());
    runProc.stderr.on('data', (data) => runOutput += data.toString());
    
    runProc.on('close', (runCode) => {
      if (runCode !== 0) {
        return res.status(500).json({ error: runOutput || 'Failed to create container' });
      }
      const containerId = runOutput.trim().substring(0, 12);
      res.json({ containerId, containerName, message: 'Container created successfully' });
    });
  });
});

// Delete container
app.delete('/api/container/:identifier', (req, res) => {
  const { identifier } = req.params;
  const { force = 'true' } = req.query; // Default to force remove
  
  console.log('Delete request for container:', identifier);
  
  // First, stop the container if it's running (force stop)
  const stopProc = spawn('docker', ['stop', identifier]);
  
  let stopOutput = '';
  stopProc.stdout.on('data', (data) => stopOutput += data.toString());
  stopProc.stderr.on('data', (data) => stopOutput += data.toString());
  
  stopProc.on('close', (stopCode) => {
    // Continue even if stop fails (container might already be stopped)
    console.log('Docker stop exit code:', stopCode);
    
    // Now remove the container (force remove to ensure it works)
    const args = ['rm', '-f', identifier];
    console.log('Running docker command:', 'docker', args.join(' '));
    
    const rmProc = spawn('docker', args);
    
    let rmOutput = '';
    rmProc.stdout.on('data', (data) => rmOutput += data.toString());
    rmProc.stderr.on('data', (data) => rmOutput += data.toString());
    
    rmProc.on('close', (rmCode) => {
      console.log('Docker rm exit code:', rmCode);
      if (rmCode !== 0) {
        return res.status(500).json({ error: rmOutput || 'Failed to delete container' });
      }
      res.json({ message: 'Container deleted successfully', containerId: identifier });
    });
    
    rmProc.on('error', (err) => {
      console.error('Docker rm error:', err);
      res.status(500).json({ error: err.message });
    });
  });
  
  stopProc.on('error', (err) => {
    console.error('Docker stop error:', err);
    // Continue with remove even if stop fails
    const args = ['rm', '-f', identifier];
    const rmProc = spawn('docker', args);
    
    let rmOutput = '';
    rmProc.stdout.on('data', (data) => rmOutput += data.toString());
    rmProc.stderr.on('data', (data) => rmOutput += data.toString());
    
    rmProc.on('close', (rmCode) => {
      if (rmCode !== 0) {
        return res.status(500).json({ error: rmOutput || 'Failed to delete container' });
      }
      res.json({ message: 'Container deleted successfully', containerId: identifier });
    });
  });
});

// Get specific container by ID or name
app.get('/api/container/:identifier', (req, res) => {
  const { identifier } = req.params;
  // Try by name first, then by ID
  const proc = spawn('docker', ['ps', '-a', '--filter', `name=${identifier}`, '--format', '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}']);
  
  let output = '';
  proc.stdout.on('data', (data) => output += data.toString());
  
  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Failed to get container' });
    }
    
    let lines = output.trim().split('\n').filter(Boolean);
    
    // If not found by name, try by ID
    if (lines.length === 0) {
      const idProc = spawn('docker', ['ps', '-a', '--filter', `id=${identifier}`, '--format', '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}']);
      let idOutput = '';
      idProc.stdout.on('data', (data) => idOutput += data.toString());
      idProc.on('close', (idCode) => {
        if (idCode !== 0) {
          return res.status(500).json({ error: 'Failed to get container' });
        }
        lines = idOutput.trim().split('\n').filter(Boolean);
        if (lines.length === 0) {
          return res.status(404).json({ error: 'Container not found' });
        }
        const [id_part, image, status, names] = lines[0].split('|');
        res.json({ container: { id: id_part, image, status, names } });
      });
      return;
    }
    
    const [id_part, image, status, names] = lines[0].split('|');
    res.json({ container: { id: id_part, image, status, names } });
  });
});

// Execute command in container
app.post('/api/exec', (req, res) => {
  const { containerId, command } = req.body;
  
  const proc = spawn('docker', ['exec', containerId, 'bash', '-c', command]);
  
  let output = '';
  let error = '';
  
  proc.stdout.on('data', (data) => output += data.toString());
  proc.stderr.on('data', (data) => error += data.toString());
  
  proc.on('close', (code) => {
    res.json({ 
      output: output || error, 
      exitCode: code 
    });
  });
});

// WebSocket connection for terminal streaming
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  let dockerProcess = null;
  let createProcess = null;

  // Send connection confirmation
  ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

  ws.on('message', (message) => {
    // Check if message is JSON (control) or raw terminal data
    let data;
    try {
      data = JSON.parse(message.toString());
      console.log('Received WebSocket message:', data.type);
    } catch (e) {
      // Raw terminal data - forward to docker process
      if (dockerProcess) {
        dockerProcess.write(message.toString());
      }
      return;
    }

    if (data.type === 'create') {
      const { image = 'ubuntu:latest' } = data;
      const containerName = `svelte-terminal-${Date.now()}`;
      
      console.log('Creating container with image:', image);
      ws.send(JSON.stringify({ type: 'log', data: `Starting container creation...\n` }));
      ws.send(JSON.stringify({ type: 'log', data: `Pulling image: ${image}...\n` }));
      
      // Pull image (this will work even if image already exists)
      const pullProc = spawn('docker', ['pull', image]);
      
      pullProc.stdout.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'log', data: data.toString() }));
      });

      pullProc.stderr.on('data', (data) => {
        ws.send(JSON.stringify({ type: 'log', data: data.toString() }));
      });

      pullProc.on('error', (err) => {
        console.error('Pull error:', err);
        ws.send(JSON.stringify({ type: 'error', message: `Failed to pull image: ${err.message}` }));
      });

      pullProc.on('close', (pullCode) => {
        console.log('Pull process closed with code:', pullCode);
        // Continue even if pull fails (image might already exist)
        if (pullCode !== 0) {
          ws.send(JSON.stringify({ type: 'log', data: `Image pull completed with warnings, continuing...\n` }));
        }
        
        ws.send(JSON.stringify({ type: 'log', data: `Creating container: ${containerName}...\n` }));
        
        // Create container
        createProcess = spawn('docker', ['run', '-dit', '--name', containerName, image, '/bin/bash']);
        
        let containerOutput = '';
        createProcess.stdout.on('data', (data) => {
          containerOutput += data.toString();
          ws.send(JSON.stringify({ type: 'log', data: data.toString() }));
        });

        createProcess.stderr.on('data', (data) => {
          containerOutput += data.toString();
          ws.send(JSON.stringify({ type: 'log', data: data.toString() }));
        });

        createProcess.on('error', (err) => {
          console.error('Container creation error:', err);
          ws.send(JSON.stringify({ type: 'error', message: `Failed to create container: ${err.message}` }));
        });

        createProcess.on('close', (runCode) => {
          console.log('Container creation closed with code:', runCode);
          console.log('Container output:', containerOutput);
          
          if (runCode !== 0) {
            ws.send(JSON.stringify({ type: 'error', message: `Failed to create container. Exit code: ${runCode}` }));
            return;
          }
          
          // Get the container ID from output or by name
          let containerId = containerOutput.trim();
          console.log('Extracted container ID from output:', containerId);
          
          if (!containerId || containerId.length < 12) {
            // Fallback: get container ID by name
            console.log('Getting container ID by name:', containerName);
            const inspectProc = spawn('docker', ['inspect', '--format', '{{.Id}}', containerName]);
            let inspectOutput = '';
            inspectProc.stdout.on('data', (data) => inspectOutput += data.toString());
            inspectProc.stderr.on('data', (data) => {
              console.error('Inspect stderr:', data.toString());
            });
            inspectProc.on('error', (err) => {
              console.error('Inspect error:', err);
              ws.send(JSON.stringify({ type: 'error', message: `Failed to inspect container: ${err.message}` }));
            });
            inspectProc.on('close', (inspectCode) => {
              if (inspectCode === 0 && inspectOutput.trim()) {
                containerId = inspectOutput.trim().substring(0, 12);
                console.log('Got container ID from inspect:', containerId);
                ws.send(JSON.stringify({ 
                  type: 'created', 
                  containerId: containerId || containerName,
                  containerName 
                }));
              } else {
                // Last resort: use container name
                console.log('Using container name as ID');
                ws.send(JSON.stringify({ 
                  type: 'created', 
                  containerId: containerName,
                  containerName 
                }));
              }
            });
          } else {
            containerId = containerId.substring(0, 12);
            console.log('Using container ID from output:', containerId);
            ws.send(JSON.stringify({ 
              type: 'created', 
              containerId,
              containerName 
            }));
          }
        });
      });
    }

    if (data.type === 'attach') {
      const { containerId, cols = 80, rows = 24 } = data;
      
      // Use node-pty for real terminal experience
      // Create PTY that executes docker exec -it
      dockerProcess = pty.spawn('docker', ['exec', '-it', containerId, '/bin/bash'], {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.env.HOME,
        env: process.env
      });

      dockerProcess.onData((data) => {
        // Send raw terminal data
        ws.send(data);
      });

      dockerProcess.onExit((code) => {
        ws.send(JSON.stringify({ type: 'exit', code }));
      });

      // Send initial ready signal
      ws.send(JSON.stringify({ type: 'ready' }));
    }

    if (data.type === 'resize' && dockerProcess) {
      const { cols, rows } = data;
      dockerProcess.resize(cols || 80, rows || 24);
    }
  });

  ws.on('close', () => {
    if (dockerProcess) {
      dockerProcess.kill();
    }
    if (createProcess) {
      createProcess.kill();
    }
  });
});