import http from 'http';
import { ObjectId } from 'mongodb';
import { db, redisClient } from './db.js';
import { CLANKER_USER_ID } from './config.js';
import { getProjectChatMessages, getProjectFileTree, getDocumentContent, getCompileLog } from './overleaf.js';

export function startDashboard(activeConnections, detectedHumans) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlParts = req.url.split('?')[0];

      if (urlParts.startsWith('/api/doc/')) {
        const docId = urlParts.replace('/api/doc/', '');
        const content = await getDocumentContent(docId);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ docId, content }));
      }

      if (urlParts.startsWith('/api/log/')) {
        const projectId = urlParts.replace('/api/log/', '');
        const log = await getCompileLog(projectId);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ projectId, log }));
      }

      if (urlParts === '/api/data') {
        const projects = await db.collection('projects').find({
          $or: [
            { owner_ref: new ObjectId(CLANKER_USER_ID) },
            { collaberator_refs: new ObjectId(CLANKER_USER_ID) },
            { readOnly_refs: new ObjectId(CLANKER_USER_ID) }
          ]
        }, { projection: { _id: 1, name: 1 } }).toArray();

        const resultProjects = [];
        for (const project of projects) {
          const projectId = project._id.toString();
          const socket = activeConnections.get(projectId);
          const isConnected = !!socket;

          const members = await redisClient.sMembers(`clients_in_project:${projectId}`);
          const membersDetails = [];
          for (const m of members) {
            const info = await redisClient.hGetAll(`connected_user:${projectId}:${m}`);
            const name = info ? `${info.first_name || ''} ${info.last_name || ''}`.trim() : '';
            const email = info ? info.email || '' : '';
            membersDetails.push({ publicId: m, name: name || 'Anon', email });
          }

          const humans = detectedHumans.get(projectId) || [];

          let chatMsgs = [];
          let fileTree = [];
          let compileLog = '';
          let firstDocContent = '';
          let firstDocName = '';
          let firstDocId = '';

          if (isConnected) {
            [chatMsgs, fileTree, compileLog] = await Promise.all([
              getProjectChatMessages(projectId, 25),
              getProjectFileTree(projectId),
              getCompileLog(projectId)
            ]);

            const firstDoc = fileTree.find(f => f.type === 'doc');
            if (firstDoc && firstDoc.id) {
              firstDocId = firstDoc.id;
              firstDocName = firstDoc.path;
              firstDocContent = await getDocumentContent(firstDoc.id);
            }
          }

          resultProjects.push({
            projectId,
            projectName: project.name,
            isConnected,
            docId: socket ? (socket.docId || 'Not joined') : 'N/A',
            clankerPublicId: socket ? (socket.publicId || 'Loading...') : 'N/A',
            connectedAt: socket && socket.connectedAt ? socket.connectedAt : null,
            membersDetails,
            humans,
            chatMsgs,
            fileTree,
            compileLog,
            firstDocId,
            firstDocName,
            firstDocContent
          });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ projects: resultProjects }));
      }

      res.writeHead(200, { "Content-Type": "text/html" });

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Clanker Dashboard</title>
          <style>
            body {
              font-family: monospace;
              background-color: #111;
              color: #ccc;
              padding: 15px;
              margin: 0;
              font-size: 13px;
            }
            h2 {
              margin: 0 0 15px 0;
              color: #4caf50;
              font-size: 16px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th, td {
              padding: 8px 10px;
              text-align: left;
              border-bottom: 1px solid #222;
              vertical-align: top;
            }
            th {
              color: #888;
              border-bottom: 2px solid #333;
            }
            .code {
              background: #222;
              padding: 1px 4px;
              border-radius: 2px;
              color: #aaa;
            }
            .connected { color: #4caf50; }
            .disconnected { color: #f44336; }
            details summary {
              cursor: pointer;
              color: #2196f3;
              padding: 4px 0;
            }
            .details-layout {
              display: flex;
              gap: 15px;
              margin-top: 8px;
            }
            .panel {
              flex: 1;
              background: #181818;
              padding: 8px;
              border: 1px solid #2a2a2a;
            }
            .panel h5 {
              margin: 0 0 6px 0;
              color: #888;
              font-size: 11px;
              text-transform: uppercase;
            }
            .scrollable {
              max-height: 200px;
              overflow-y: auto;
            }
            .chat-line {
              margin-bottom: 4px;
              line-height: 1.3;
            }
            .clanker-green {
              color: #4caf50;
              font-weight: bold;
            }
            .user-blue {
              color: #38bdf8;
            }
            .file-line {
              cursor: pointer;
              padding: 2px 4px;
              margin-bottom: 2px;
            }
            .file-line:hover {
              background: #252525;
            }
            .file-line.selected {
              background: #333;
              color: #fff;
            }
            pre.content-view {
              margin: 0;
              white-space: pre-wrap;
              word-break: break-word;
              max-height: 200px;
              overflow-y: auto;
              color: #ddd;
            }
          </style>
        </head>
        <body>
          <h2>Clanker Control Center</h2>
          
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>ID</th>
                <th>Status</th>
                <th>Doc ID</th>
                <th>Public ID</th>
                <th>Redis Set (clients)</th>
                <th>Humans</th>
              </tr>
            </thead>
            <tbody id="projects-tbody">
              <tr><td colspan="7">Loading...</td></tr>
            </tbody>
          </table>

          <script>
            let selectedDocs = {};
            let savedScrolls = {};

            function trackScroll(id, el) {
              const isBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 20;
              savedScrolls[id] = {
                scrollTop: el.scrollTop,
                isAtBottom: isBottom
              };
            }

            async function syncData() {
              try {
                const res = await fetch('/api/data');
                const json = await res.json();
                if (json.projects) {
                  render(json.projects);
                }
              } catch (err) {
                console.error('Sync error:', err);
              }
            }

            function render(projects) {
              const tbody = document.getElementById('projects-tbody');

              let html = '';
              projects.forEach(p => {
                const isOpen = localStorage.getItem('det_' + p.projectId) === '1';

                const status = p.isConnected 
                  ? '<span class="connected">Connected</span>' 
                  : '<span class="disconnected">Disconnected</span>';

                const clients = p.membersDetails.length > 0
                  ? p.membersDetails.map(m => {
                      const isClanker = m.name.toLowerCase().includes('clanker') || m.email.includes('clanker');
                      const cls = isClanker ? 'clanker-green' : '';
                      return m.publicId + ' (<span class="' + cls + '">' + m.name + '</span>)';
                    }).join('<br>')
                  : '<em style="color:#555">Empty</em>';

                const humans = p.humans.length > 0
                  ? p.humans.map(h => h.name + ' [' + h.publicId + ']').join('<br>')
                  : '<em style="color:#555">None</em>';

                let chat = '<em style="color:#555">No chat</em>';
                if (p.chatMsgs && p.chatMsgs.length > 0) {
                  // Reverse list so latest message is at the bottom (chronological order)
                  const chronological = p.chatMsgs.slice().reverse();
                  chat = chronological.map(m => {
                    const isClankerSender = m.user_id === '6a5b2df0a248ebd044b6274d' || 
                      (m.user && ((m.user.first_name && m.user.first_name.toLowerCase().includes('clanker')) || (m.user.email && m.user.email.includes('clanker'))));
                    
                    const senderName = m.user ? (m.user.first_name || 'User') : 'User';
                    const senderHtml = isClankerSender 
                      ? '<strong class="clanker-green">' + senderName + ':</strong>' 
                      : '<strong class="user-blue">' + senderName + ':</strong>';

                    let rawContent = m.content || '';
                    let coloredContent = rawContent.replace(/(@clanker|@clank|clanker|clank)/gi, '<span class="clanker-green">$1</span>');

                    return '<div class="chat-line">' + senderHtml + ' ' + coloredContent + '</div>';
                  }).join('');
                }

                let files = '<em style="color:#555">No files</em>';
                if (p.fileTree && p.fileTree.length > 0) {
                  files = p.fileTree.map(f => {
                    const selClass = (selectedDocs[p.projectId] === f.id || (!selectedDocs[p.projectId] && p.firstDocId === f.id)) ? ' selected' : '';
                    return '<div class="file-line' + selClass + '" onclick="loadFile(\\\'' + p.projectId + '\\\', \\\'' + f.id + '\\\', \\\'' + f.path + '\\\', \\\'' + f.type + '\\\', this)">[' + f.type.toUpperCase() + '] ' + f.path + '</div>';
                  }).join('');
                }

                const docName = selectedDocs[p.projectId + '_name'] || p.firstDocName || 'None';
                const docText = selectedDocs[p.projectId + '_text'] !== undefined ? selectedDocs[p.projectId + '_text'] : (p.firstDocContent || '');

                html += \`
                  <tr>
                    <td><strong>\${p.projectName}</strong></td>
                    <td><span class="code">\${p.projectId}</span></td>
                    <td>\${status}</td>
                    <td><span class="code">\${p.docId}</span></td>
                    <td><span class="code">\${p.clankerPublicId}</span></td>
                    <td>\${clients}</td>
                    <td>\${humans}</td>
                  </tr>
                  \${p.isConnected ? \`
                  <tr>
                    <td colspan="7" style="padding: 0 10px 10px 10px; border-bottom: 2px solid #333;">
                      <details id="det-\${p.projectId}" \${isOpen ? 'open' : ''} ontoggle="toggleDet('\${p.projectId}', this.open)">
                        <summary>Expand Reader Data (Chat, Files & Compile Log)</summary>
                        <div class="details-layout">
                          <div class="panel">
                            <h5>Chat</h5>
                            <div class="scrollable" id="chat-scroll-\${p.projectId}" onscroll="trackScroll('chat-scroll-\${p.projectId}', this)">\${chat}</div>
                          </div>
                          <div class="panel">
                            <h5>Files</h5>
                            <div class="scrollable" id="files-scroll-\${p.projectId}" onscroll="trackScroll('files-scroll-\${p.projectId}', this)">\${files}</div>
                          </div>
                          <div class="panel">
                            <h5 id="view-head-\${p.projectId}">View: \${docName}</h5>
                            <pre class="content-view" id="content-scroll-\${p.projectId}" onscroll="trackScroll('content-scroll-\${p.projectId}', this)">\${docText}</pre>
                          </div>
                          <div class="panel">
                            <h5>Compile Log</h5>
                            <pre class="content-view" id="log-scroll-\${p.projectId}" onscroll="trackScroll('log-scroll-\${p.projectId}', this)">\${(p.compileLog || 'No compile log available.').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                          </div>
                        </div>
                      </details>
                    </td>
                  </tr>
                  \` : ''}
                \`;
              });

              tbody.innerHTML = html;

              // Restore scroll states cleanly
              projects.forEach(p => {
                const chatId = 'chat-scroll-' + p.projectId;
                const chatEl = document.getElementById(chatId);
                if (chatEl) {
                  const state = savedScrolls[chatId];
                  if (!state || state.isAtBottom) {
                    chatEl.scrollTop = chatEl.scrollHeight; // Default/at-bottom -> scroll to bottom
                  } else {
                    chatEl.scrollTop = state.scrollTop; // Locked position when reading older messages
                  }
                }

                const filesId = 'files-scroll-' + p.projectId;
                const filesEl = document.getElementById(filesId);
                if (filesEl && savedScrolls[filesId]) {
                  filesEl.scrollTop = savedScrolls[filesId].scrollTop;
                }

                const contentId = 'content-scroll-' + p.projectId;
                const contentEl = document.getElementById(contentId);
                if (contentEl && savedScrolls[contentId]) {
                  contentEl.scrollTop = savedScrolls[contentId].scrollTop;
                }

                const logId = 'log-scroll-' + p.projectId;
                const logEl = document.getElementById(logId);
                if (logEl && savedScrolls[logId]) {
                  logEl.scrollTop = savedScrolls[logId].scrollTop;
                }
              });
            }

            function toggleDet(id, open) {
              if (open) {
                localStorage.setItem('det_' + id, '1');
                setTimeout(() => {
                  const chatEl = document.getElementById('chat-scroll-' + id);
                  if (chatEl && (!savedScrolls['chat-scroll-' + id] || savedScrolls['chat-scroll-' + id].isAtBottom)) {
                    chatEl.scrollTop = chatEl.scrollHeight;
                  }
                }, 50);
              } else {
                localStorage.removeItem('det_' + id);
              }
            }

            async function loadFile(projectId, docId, path, type, el) {
              const head = document.getElementById('view-head-' + projectId);
              const view = document.getElementById('content-scroll-' + projectId);

              const parent = el.parentElement;
              parent.querySelectorAll('.file-line').forEach(item => item.classList.remove('selected'));
              el.classList.add('selected');

              head.innerText = 'View: ' + path;
              selectedDocs[projectId + '_name'] = path;

              if (type !== 'doc' || !docId) {
                const text = '[Binary file: ' + path + ']';
                view.innerText = text;
                selectedDocs[projectId + '_text'] = text;
                selectedDocs[projectId] = docId;
                return;
              }

              view.innerText = 'Loading...';
              try {
                const res = await fetch('/api/doc/' + docId);
                const data = await res.json();
                const text = data.content || '[Empty]';
                view.innerText = text;
                selectedDocs[projectId + '_text'] = text;
                selectedDocs[projectId] = docId;
              } catch (err) {
                view.innerText = 'Error: ' + err.message;
              }
            }

            syncData();
            setInterval(syncData, 5000);
          </script>
        </body>
        </html>
      `;
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Dashboard error: ${err.message}`);
    }
  });

  server.listen(5050, () => {
    console.log("Clanker dashboard is running at http://localhost:5050");
  });
}
