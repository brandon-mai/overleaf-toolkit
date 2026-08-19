import './hijack.js';
import io from 'socket.io-client';
import { ObjectId } from 'mongodb';

import { SHARELATEX_URL, CLANKER_USER_ID } from './src/config.js';
import { initDb, redisClient, db } from './src/db.js';
import { callLLM } from './src/llm.js';
import { findFirstDocId, sendChatMessage, checkPendingInvites } from './src/overleaf.js';
import { startDashboard } from './src/dashboard.js';

const activeConnections = new Map();
const detectedHumans = new Map();

async function handleMessage(projectId, message) {
  console.log(`Processing mention in project ${projectId}: "${message.content}"`);
  try {
    const cleanPrompt = message.content.replace(/@(clanker|clank)/gi, '').trim();
    const reply = await callLLM(cleanPrompt);
    await sendChatMessage(projectId, reply);
    console.log(`Successfully replied to mention in project ${projectId}`);
  } catch (err) {
    console.error("Error handling message:", err.message);
  }
}

async function sendHeartbeats() {
  for (const [projectId, socket] of activeConnections.entries()) {
    if (socket.docId) {
      socket.emit('clientTracking.updatePosition', {
        doc_id: socket.docId,
        row: 0,
        column: 0
      }, () => {});
    }
    if (socket.publicId) {
      const key = `connected_user:${projectId}:${socket.publicId}`;
      try {
        await redisClient.hSet(key, 'last_updated_at', Date.now().toString());
        await redisClient.expire(key, 900);
      } catch (err) {
        // ignore
      }
    }
  }
}

async function disconnectProject(projectId) {
  const socket = activeConnections.get(projectId);
  if (socket) {
    socket.disconnect();
    activeConnections.delete(projectId);
  }
  detectedHumans.delete(projectId);
}

async function scanActiveProjects() {
  try {
    const projects = await db.collection('projects').find({
      $or: [
        { owner_ref: new ObjectId(CLANKER_USER_ID) },
        { collaberator_refs: new ObjectId(CLANKER_USER_ID) },
        { readOnly_refs: new ObjectId(CLANKER_USER_ID) }
      ]
    }, { projection: { _id: 1, name: 1 } }).toArray();

    const activeProjectIds = new Set();

    for (const project of projects) {
      const projectId = project._id.toString();
      
      const key = `clients_in_project:${projectId}`;
      const members = await redisClient.sMembers(key);
      if (!members || members.length === 0) {
        detectedHumans.set(projectId, []);
        continue;
      }
      
      const currentSocket = activeConnections.get(projectId);
      const clankerPublicId = currentSocket && currentSocket.publicId;
      const humanMembers = members.filter(m => m !== clankerPublicId);
      
      const humansList = [];
      for (const memberId of humanMembers) {
        const info = await redisClient.hGetAll(`connected_user:${projectId}:${memberId}`);
        if (info && Object.keys(info).length > 0) {
          humansList.push({
            publicId: memberId,
            userId: info.user_id || '',
            name: `${info.first_name || ''} ${info.last_name || ''}`.trim() || 'Anonymous Guest',
            email: info.email || ''
          });
        } else {
          humansList.push({
            publicId: memberId,
            userId: 'N/A',
            name: 'Active Editor (Idle)',
            email: 'N/A'
          });
        }
      }
      
      detectedHumans.set(projectId, humansList);
      
      if (humanMembers.length > 0) {
        activeProjectIds.add(projectId);
      }
    }

    for (const projectId of activeProjectIds) {
      if (!activeConnections.has(projectId)) {
        console.log(`Connecting Clanker to active project: ${projectId}`);
        
        const socket = io.connect(SHARELATEX_URL, {
          'force new connection': true,
          query: `projectId=${projectId}`
        });

        socket.on('connect', () => {
          console.log(`Clanker socket connected to project ${projectId} with socket ID: ${socket.socket.sessionid}`);
        });

        socket.on('joinProjectResponse', (data) => {
          if (data && data.publicId) {
            socket.publicId = data.publicId;
            socket.connectedAt = new Date();
            socket.projectName = data.project ? data.project.name : 'Unknown';
            console.log(`Clanker received publicId ${data.publicId} for project ${projectId}`);
            
            const projectInfo = data.project;
            const docId = projectInfo && (projectInfo.rootDoc_id || (projectInfo.rootFolder ? findFirstDocId(projectInfo.rootFolder[0] || projectInfo.rootFolder) : null));
            if (docId) {
              console.log(`Clanker joining root doc ${docId} of project ${projectId}`);
              socket.emit('joinDoc', docId, -1, {}, (err) => {
                if (err) {
                  console.error(`Clanker failed to join doc ${docId}:`, err);
                } else {
                  console.log(`Clanker successfully joined doc ${docId}`);
                  socket.docId = docId;
                  socket.emit('clientTracking.updatePosition', {
                    doc_id: docId,
                    row: 0,
                    column: 0
                  }, () => {});
                }
              });
            }
          }
        });

        socket.on('connect_failed', (err) => {
          console.error(`Clanker socket connection failed for project ${projectId}:`, err);
          disconnectProject(projectId);
        });

        socket.on('error', (err) => {
          console.error(`Clanker socket error for project ${projectId}:`, err);
          disconnectProject(projectId);
        });

        socket.on('connectionRejected', (err) => {
          console.error(`Clanker socket connection rejected for project ${projectId}:`, JSON.stringify(err));
          disconnectProject(projectId);
        });

        socket.on('new-chat-message', async (message) => {
          if (message.user_id === CLANKER_USER_ID) return;
          const isMention = message.content && (
            message.content.toLowerCase().includes('@clanker') || 
            message.content.toLowerCase().includes('@clank')
          );
          if (isMention) {
            await handleMessage(projectId, message);
          }
        });

        socket.on('disconnect', () => {
          console.log(`Clanker socket disconnected from project ${projectId}`);
          disconnectProject(projectId);
        });

        activeConnections.set(projectId, socket);
      }
    }

    for (const [projectId, socket] of activeConnections.entries()) {
      if (!activeProjectIds.has(projectId)) {
        console.log(`Disconnecting Clanker from inactive project: ${projectId}`);
        await disconnectProject(projectId);
      }
    }

  } catch (err) {
    console.error("Error scanning active projects:", err);
  }
}

async function main() {
  await initDb();
  startDashboard(activeConnections, detectedHumans);
  
  setInterval(scanActiveProjects, 5000);
  setInterval(sendHeartbeats, 5000);
  setInterval(checkPendingInvites, 5000);
  await scanActiveProjects();
}

main().catch(console.error);
