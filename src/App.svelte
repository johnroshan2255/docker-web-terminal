<script>
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from 'xterm';
  import { FitAddon } from 'xterm-addon-fit';

  let containers = [];
  let selectedContainer = null;
  let ws = null;
  let terminalElement;
  let xtermTerminal = null;
  let fitAddon = null;
  let image = 'ubuntu:latest';
  let creating = false;
  let connected = false;
  let createdContainerId = null;
  let isTerminalReady = false;
  let terminalInitialized = false;

  const API_URL = 'http://localhost:3001';
  const WS_URL = 'ws://localhost:3001';

  onMount(() => {
    // Initialize xterm terminal after a small delay to ensure DOM is ready
    setTimeout(() => {
      initTerminal();
    }, 100);
  });

  onDestroy(() => {
    if (ws) {
      ws.close();
    }
    if (xtermTerminal) {
      xtermTerminal.dispose();
    }
    if (typeof window !== 'undefined' && window._terminalResizeHandler) {
      window.removeEventListener('resize', window._terminalResizeHandler);
    }
  });

  function initTerminal() {
    if (!terminalElement) return;
    
    // Dispose existing terminal if any
    if (xtermTerminal) {
      xtermTerminal.dispose();
    }
    
    xtermTerminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      disableStdin: true, // Disable input until connected
      theme: {
        background: '#0a0a0a',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#ffffff',
        selection: '#333333',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#bd93f9',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#ffffff',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92d0',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff'
      }
    });

    fitAddon = new FitAddon();
    xtermTerminal.loadAddon(fitAddon);
    xtermTerminal.open(terminalElement);
    fitAddon.fit();

    // Set up terminal event handlers only once
    if (!terminalInitialized) {
      // Handle terminal input
      xtermTerminal.onData((data) => {
        // Only allow input when connected and terminal is ready
        if (ws && ws.readyState === WebSocket.OPEN && isTerminalReady && connected) {
          // Send raw terminal input
          ws.send(data);
        }
        // Otherwise ignore input (terminal is disabled)
      });

      // Handle terminal resize
      xtermTerminal.onResize((size) => {
        if (ws && ws.readyState === WebSocket.OPEN && isTerminalReady && connected) {
          // Send resize event to server
          ws.send(JSON.stringify({ 
            type: 'resize', 
            cols: size.cols, 
            rows: size.rows 
          }));
        }
      });

      terminalInitialized = true;
    }

    // Handle window resize
    const resizeHandler = () => {
      if (fitAddon) {
        fitAddon.fit();
        // Notify server of resize if connected
        if (ws && ws.readyState === WebSocket.OPEN && isTerminalReady && connected && xtermTerminal) {
          ws.send(JSON.stringify({ 
            type: 'resize', 
            cols: xtermTerminal.cols, 
            rows: xtermTerminal.rows 
          }));
        }
      }
    };
    
    window.addEventListener('resize', resizeHandler);
    
    // Store handler for cleanup if needed
    if (typeof window !== 'undefined') {
      window._terminalResizeHandler = resizeHandler;
    }
  }

  async function loadContainer(containerId) {
    try {
      const response = await fetch(`${API_URL}/api/container/${containerId}`);
      const data = await response.json();
      if (data.container) {
        containers = [data.container];
        return data.container;
      }
    } catch (error) {
      if (xtermTerminal) {
        xtermTerminal.write('Error loading container: ' + error.message + '\r\n');
      }
      throw error;
    }
  }

  async function deleteContainer(container, event) {
    event.stopPropagation();
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete container "${container.names}"?`)) {
      return;
    }

    // If this container is connected, disconnect first
    if (connected && selectedContainer?.id === container.id) {
      disconnect();
    }

    try {
      const response = await fetch(`${API_URL}/api/container/${container.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();

      if (response.ok) {
        // Remove from containers list
        containers = containers.filter(c => c.id !== container.id);
        
        // Clear selection if deleted container was selected
        if (selectedContainer?.id === container.id) {
          selectedContainer = null;
        }

        // Show success message in terminal if available
        if (xtermTerminal) {
          xtermTerminal.write(`\r\n✓ Container "${container.names}" deleted successfully\r\n`);
        }
      } else {
        if (xtermTerminal) {
          xtermTerminal.write(`\r\n✗ Error deleting container: ${data.error}\r\n`);
        }
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      if (xtermTerminal) {
        xtermTerminal.write(`\r\n✗ Error: ${error.message}\r\n`);
      }
      alert(`Error: ${error.message}`);
    }
  }

  function createContainer() {
    creating = true;
    containers = [];
    selectedContainer = null;
    createdContainerId = null;
    
    // Ensure terminal is initialized
    if (!xtermTerminal && terminalElement) {
      initTerminal();
    }
    
    // Clear terminal and show creation message
    if (xtermTerminal) {
      xtermTerminal.clear();
      xtermTerminal.write('Creating container with image: ' + image + '...\r\n');
    }
    
    // Close existing WebSocket if any
    if (ws) {
      ws.close();
    }

    // Create new WebSocket connection for creation logs
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket opened, sending create message');
      if (xtermTerminal) {
        xtermTerminal.write('Connecting to server...\r\n');
      }
      
      // Wait a bit to ensure connection is fully established
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'create', 
            image 
          }));
          console.log('Create message sent');
        } else {
          if (xtermTerminal) {
            xtermTerminal.write('\r\nError: WebSocket not ready\r\n');
          }
          creating = false;
        }
      }, 100);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
        
        if (data.type === 'connected') {
          if (xtermTerminal) {
            xtermTerminal.write('Connected to server...\r\n');
          }
        } else if (data.type === 'log') {
          if (xtermTerminal) {
            // Ensure proper line formatting for logs
            let logData = data.data;
            // Replace single \n with \r\n for proper terminal formatting
            logData = logData.replace(/\n/g, '\r\n');
            xtermTerminal.write(logData);
          }
        } else if (data.type === 'created') {
          if (xtermTerminal) {
            xtermTerminal.write('\r\n✓ Container created successfully!\r\n');
            xtermTerminal.write('Container ID: ' + data.containerId + '\r\n');
            xtermTerminal.write('Container Name: ' + data.containerName + '\r\n');
            xtermTerminal.write('Connecting to container...\r\n\r\n');
          }
          createdContainerId = data.containerId;
          creating = false;
          // Load the created container and auto-connect
          loadContainer(data.containerName || data.containerId).then(() => {
            // Auto-connect to the newly created container
            if (containers.length > 0) {
              setTimeout(() => {
                connectToContainer(containers[0]);
              }, 500);
            }
          });
        } else if (data.type === 'error') {
          if (xtermTerminal) {
            xtermTerminal.write('\r\nError: ' + data.message + '\r\n');
          }
          creating = false;
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
        if (xtermTerminal) {
          xtermTerminal.write('\r\nError: Failed to parse server message\r\n');
        }
        creating = false;
      }
    };

    ws.onerror = (error) => {
      if (xtermTerminal) {
        xtermTerminal.write('\r\nWebSocket error: ' + (error.message || 'Connection failed') + '\r\n');
      }
      creating = false;
      console.error('WebSocket error:', error);
    };

    ws.onclose = (event) => {
      if (creating) {
        if (xtermTerminal) {
          xtermTerminal.write('\r\nWebSocket closed unexpectedly. Code: ' + event.code + '\r\n');
        }
        creating = false;
      }
      console.log('WebSocket closed:', event.code, event.reason);
    };
  }

  function connectToContainer(container) {
    selectedContainer = container;
    connected = false;
    isTerminalReady = false;

    if (ws) {
      ws.close();
    }

    // Ensure terminal is initialized
    if (!xtermTerminal && terminalElement) {
      initTerminal();
    }

    // Clear terminal and resize
    if (xtermTerminal) {
      xtermTerminal.clear();
      xtermTerminal.write('Connecting to container ' + container.names + '...\r\n');
      // Disable input temporarily
      xtermTerminal.options.disableStdin = true;
      if (fitAddon) {
        fitAddon.fit();
      }
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      // Get terminal size
      const cols = xtermTerminal ? xtermTerminal.cols : 80;
      const rows = xtermTerminal ? xtermTerminal.rows : 24;
      
      ws.send(JSON.stringify({ 
        type: 'attach', 
        containerId: container.id,
        cols,
        rows
      }));
    };

    ws.onmessage = (event) => {
      // Handle both string and binary data
      let dataStr = '';
      if (typeof event.data === 'string') {
        dataStr = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        dataStr = new TextDecoder().decode(event.data);
      } else if (event.data instanceof Blob) {
        // Handle blob by reading as text
        event.data.text().then(text => {
          handleTerminalMessage(text);
        });
        return;
      } else {
        dataStr = String(event.data);
      }
      
      handleTerminalMessage(dataStr);
    };
    
    function handleTerminalMessage(dataStr) {
      // Check if it's JSON (for control messages) or raw terminal data
      if (dataStr.startsWith('{')) {
        try {
          const data = JSON.parse(dataStr);
          
          if (data.type === 'ready') {
            connected = true;
            isTerminalReady = true;
            if (xtermTerminal) {
              xtermTerminal.clear();
              // Enable input now that we're connected
              xtermTerminal.options.disableStdin = false;
              // Focus the terminal for input
              xtermTerminal.focus();
            }
          } else if (data.type === 'exit') {
            if (xtermTerminal) {
              xtermTerminal.write('\r\n[Process exited]\r\n');
              xtermTerminal.options.disableStdin = true;
            }
            connected = false;
            isTerminalReady = false;
          } else if (data.type === 'error') {
            if (xtermTerminal) {
              xtermTerminal.write(`\r\nError: ${data.message}\r\n`);
            }
          }
        } catch (e) {
          // Not JSON, treat as raw terminal data
          if (xtermTerminal && isTerminalReady) {
            xtermTerminal.write(dataStr);
          }
        }
      } else {
        // Raw terminal data
        if (xtermTerminal && isTerminalReady) {
          xtermTerminal.write(dataStr);
        }
      }
    }

    ws.onerror = (error) => {
      if (xtermTerminal) {
        xtermTerminal.write('\r\nWebSocket error\r\n');
      }
    };

    ws.onclose = () => {
      if (connected) {
        if (xtermTerminal) {
          xtermTerminal.write('\r\n[Disconnected]\r\n');
          // Disable input when disconnected
          xtermTerminal.options.disableStdin = true;
        }
      }
      connected = false;
      isTerminalReady = false;
    };

    // Terminal handlers are set up in initTerminal() and persist
    // They check connection state before processing
  }

  function clearTerminal() {
    if (xtermTerminal) {
      xtermTerminal.clear();
    }
  }

  function disconnect() {
    if (ws) {
      ws.close();
    }
    connected = false;
    selectedContainer = null;
  }
</script>

<main>
  <div class="container">
    <div class="header">
      <h1><i class="fa fa-terminal"></i> Docker Terminal</h1>
      {#if connected && selectedContainer}
        <div class="connection-status">
          <span class="status-indicator"></span>
          Connected to: {selectedContainer.names}
          <button class="disconnect-btn" on:click={disconnect}>Disconnect</button>
        </div>
      {/if}
    </div>
    
    <div class="controls">
      <div class="create-section">
        <button on:click={createContainer} disabled={creating} class="create-btn primary-btn">
          {#if creating}
            <i class="fa fa-spinner fa-spin"></i> Creating...
          {:else}
            <i class="fa fa-plus"></i> Create Container
          {/if}
        </button>
      </div>

      <div class="containers-section">
        <h3><i class="fa fa-cube"></i> Available Containers:</h3>
        {#if containers.length === 0}
          <p class="no-containers">No containers found. Create one above!</p>
        {:else}
          <div class="container-list">
            {#each containers as container}
              <div class="container-item" class:active={selectedContainer?.id === container.id}>
                <div class="container-info">
                  <strong>{container.names}</strong>
                  <span class="container-id">ID: {container.id}</span>
                  <span class="status" class:running={container.status.includes('Up')}>
                    {container.status}
                  </span>
                  <span class="image">Image: {container.image}</span>
                </div>
                <div class="container-actions">
                  <button 
                    on:click={() => connectToContainer(container)}
                    disabled={connected && selectedContainer?.id === container.id}
                    class="connect-btn"
                  >
                    {#if connected && selectedContainer?.id === container.id}
                      <i class="fa fa-check"></i> Connected
                    {:else}
                      <i class="fa fa-plug"></i> Connect
                    {/if}
                  </button>
                  <button 
                    on:click={(e) => deleteContainer(container, e)}
                    class="delete-btn"
                    title="Delete container"
                  >
                    <i class="fa fa-trash"></i> Delete
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="terminal-section">
      <div class="terminal-header">
        <span>Terminal</span>
        <button on:click={clearTerminal} class="clear-btn">Clear</button>
      </div>
      <div class="terminal-container" bind:this={terminalElement}>
        {#if !connected}
          <div class="terminal-placeholder">
            <i class="fa fa-info-circle"></i> Create a container or connect to an existing one to start...
          </div>
        {/if}
      </div>
    </div>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
    background: #000000;
    color: #ffffff;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  main {
    padding: 0;
    max-width: 100%;
    margin: 0;
    min-height: 100vh;
    background: #000000;
  }

  .container {
    background: #000000;
    padding: 0;
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 1px solid #1a1a1a;
  }

  h1 {
    margin: 0;
    color: #ffffff;
    font-size: 24px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
    letter-spacing: -0.02em;
  }

  h1 i {
    font-size: 0.9em;
    color: #888888;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  h3 i {
    font-size: 0.9em;
    color: #888888;
  }

  button i {
    margin-right: 6px;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #111111;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    color: #888888;
    border: 1px solid #1a1a1a;
  }

  .status-indicator {
    width: 8px;
    height: 8px;
    background: #00ff88;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .controls {
    margin-bottom: 32px;
  }

  .create-section {
    display: flex;
    gap: 8px;
    margin-bottom: 32px;
  }

  button {
    padding: 10px 16px;
    background: #ffffff;
    color: #000000;
    border: 1px solid #1a1a1a;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
    font-size: 14px;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  button:hover:not(:disabled) {
    background: #f5f5f5;
    border-color: #333333;
  }

  button:active:not(:disabled) {
    background: #e5e5e5;
  }

  button:disabled {
    background: #111111;
    color: #666666;
    border-color: #1a1a1a;
    cursor: not-allowed;
    opacity: 0.5;
  }

  .primary-btn {
    background: #ffffff;
    color: #000000;
  }

  .primary-btn:hover:not(:disabled) {
    background: #f5f5f5;
  }

  .primary-btn:disabled {
    background: #111111;
    color: #666666;
  }

  .disconnect-btn {
    background: #111111;
    color: #ffffff;
    padding: 6px 12px;
    font-size: 12px;
    border-color: #1a1a1a;
  }

  .disconnect-btn:hover {
    background: #1a1a1a;
    border-color: #333333;
  }

  .containers-section {
    margin-bottom: 32px;
  }

  .no-containers {
    color: #666666;
    padding: 40px 20px;
    text-align: center;
    font-size: 14px;
    background: #111111;
    border: 1px solid #1a1a1a;
    border-radius: 6px;
  }

  .container-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .container-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    background: #111111;
    border-radius: 6px;
    border: 1px solid #1a1a1a;
    transition: all 0.2s;
  }

  .container-item:hover {
    border-color: #333333;
    background: #1a1a1a;
  }

  .container-item.active {
    border-color: #333333;
    background: #1a1a1a;
  }

  .container-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }

  .container-info strong {
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
  }

  .container-id, .image {
    font-size: 12px;
    color: #666666;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  }

  .status {
    font-size: 12px;
    color: #ff6b6b;
    font-weight: 500;
    display: inline-block;
    padding: 2px 8px;
    background: #1a1a1a;
    border-radius: 4px;
    width: fit-content;
  }

  .status.running {
    color: #00ff88;
  }

  .connect-btn {
    background: #111111;
    color: #ffffff;
    border-color: #1a1a1a;
    padding: 8px 14px;
    font-size: 13px;
  }

  .connect-btn:hover:not(:disabled) {
    background: #1a1a1a;
    border-color: #333333;
  }

  .container-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .delete-btn {
    background: #111111;
    color: #ff5555;
    border-color: #1a1a1a;
    padding: 8px 14px;
    font-size: 13px;
  }

  .delete-btn:hover {
    background: #1a1a1a;
    border-color: #ff5555;
    color: #ff6e6e;
  }

  .delete-btn {
    background: #111111;
    color: #ff5555;
    border-color: #1a1a1a;
    padding: 8px 14px;
    font-size: 13px;
  }

  .delete-btn:hover {
    background: #1a1a1a;
    border-color: #ff5555;
    color: #ff6e6e;
  }

  .terminal-section {
    margin-top: 32px;
    display: flex;
    flex-direction: column;
    min-height: 500px;
  }

  .terminal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #111111;
    border-radius: 6px 6px 0 0;
    border: 1px solid #1a1a1a;
    border-bottom: none;
  }

  .terminal-header span {
    font-size: 13px;
    font-weight: 500;
    color: #888888;
  }

  .clear-btn {
    background: transparent;
    color: #888888;
    padding: 6px 12px;
    font-size: 12px;
    border: 1px solid #1a1a1a;
  }

  .clear-btn:hover {
    background: #1a1a1a;
    color: #ffffff;
    border-color: #333333;
  }

  .terminal-container {
    background: #0a0a0a;
    border: 1px solid #1a1a1a;
    border-radius: 0 0 6px 6px;
    min-height: 500px;
    height: 500px;
    padding: 12px;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .terminal-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666666;
    font-size: 14px;
    gap: 8px;
  }

  :global(.xterm) {
    height: 100% !important;
    width: 100% !important;
  }

  :global(.xterm-viewport) {
    background: #0a0a0a !important;
  }

  :global(.xterm-screen) {
    background: #0a0a0a !important;
  }

  :global(.xterm .xterm-viewport) {
    background-color: #0a0a0a !important;
  }

  :global(.xterm .xterm-text-layer) {
    color: #ffffff !important;
  }

  :global(.xterm .xterm-cursor-layer) {
    color: #ffffff !important;
  }
</style>