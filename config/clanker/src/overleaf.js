import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { ObjectId } from 'mongodb';
import { SHARELATEX_URL, cookieHeader } from './config.js';
import { redisClient, db } from './db.js';

export function findFirstDocId(folder) {
  if (!folder) return null;
  if (folder.docs && folder.docs.length > 0) {
    const doc = folder.docs[0];
    return doc._id || doc.id;
  }
  if (folder.folders && folder.folders.length > 0) {
    for (const subfolder of folder.folders) {
      const docId = findFirstDocId(subfolder);
      if (docId) return docId;
    }
  }
  return null;
}

export async function getCsrfToken(projectId) {
  const getUrl = `${SHARELATEX_URL}/project/${projectId}`;
  const getResponse = await axios.get(getUrl, {
    headers: { Cookie: cookieHeader }
  });
  const html = getResponse.data || '';
  const match = html.match(/name="ol-csrfToken"\s+content="([^"]+)"/) || html.match(/window\.csrfToken\s*=\s*"([^"]+)"/);
  if (!match || !match[1]) {
    throw new Error('Could not parse CSRF token from project page');
  }
  return match[1];
}

export async function sendChatMessage(projectId, content) {
  const csrfToken = await getCsrfToken(projectId);
  await axios.post(`${SHARELATEX_URL}/project/${projectId}/messages`, {
    content,
    _csrf: csrfToken
  }, {
    headers: { 
      Cookie: cookieHeader,
      'x-csrf-token': csrfToken
    }
  });
}

export async function getProjectChatMessages(projectId, limit = 15) {
  try {
    const url = `${SHARELATEX_URL}/project/${projectId}/messages?limit=${limit}`;
    const response = await axios.get(url, {
      headers: { Cookie: cookieHeader }
    });
    return response.data || [];
  } catch (err) {
    console.error(`Failed to fetch chat messages for project ${projectId}:`, err.message);
    return [];
  }
}

export async function getProjectFileTree(projectId) {
  try {
    const project = await db.collection('projects').findOne(
      { _id: new ObjectId(projectId) },
      { projection: { rootFolder: 1 } }
    );
    if (!project || !project.rootFolder) return [];

    const fileList = [];
    function traverse(folder, currentPath = '') {
      if (!folder) return;
      if (folder.docs) {
        for (const doc of folder.docs) {
          fileList.push({
            id: doc._id ? doc._id.toString() : '',
            name: doc.name,
            path: currentPath ? `${currentPath}/${doc.name}` : doc.name,
            type: 'doc'
          });
        }
      }
      if (folder.fileRefs) {
        for (const file of folder.fileRefs) {
          fileList.push({
            id: file._id ? file._id.toString() : '',
            name: file.name,
            path: currentPath ? `${currentPath}/${file.name}` : file.name,
            type: 'file'
          });
        }
      }
      if (folder.folders) {
        for (const subfolder of folder.folders) {
          traverse(subfolder, currentPath ? `${currentPath}/${subfolder.name}` : subfolder.name);
        }
      }
    }

    const root = Array.isArray(project.rootFolder) ? project.rootFolder[0] : project.rootFolder;
    traverse(root, '');
    return fileList;
  } catch (err) {
    console.error(`Failed to fetch file tree for project ${projectId}:`, err.message);
    return [];
  }
}

export async function getDocumentContent(docId) {
  if (!docId) return '';
  try {
    const doc = await db.collection('docs').findOne({ _id: new ObjectId(docId) });
    if (!doc || !doc.lines) return '';
    return doc.lines.join('\n');
  } catch (err) {
    console.error(`Failed to fetch document content for doc ${docId}:`, err.message);
    return '';
  }
}

export async function checkPendingInvites() {
  try {
    const inviteStr = await redisClient.rPop('clanker:pending_invites');
    if (inviteStr) {
      const invite = JSON.parse(inviteStr);
      console.log(`Clanker bot detected pending invite for project ${invite.projectId}`);
      
      const getUrl = `${SHARELATEX_URL}/project/${invite.projectId}/invite/token/${invite.token}`;
      const getResponse = await axios.get(getUrl, {
        headers: { Cookie: cookieHeader }
      });
      
      const html = getResponse.data || '';
      const csrfMatch = html.match(/name="ol-csrfToken"\s+content="([^"]+)"/) || html.match(/window\.csrfToken\s*=\s*"([^"]+)"/);
      if (!csrfMatch || !csrfMatch[1]) {
        console.error(`Could not parse CSRF token for invite acceptance in project ${invite.projectId}`);
        return;
      }
      const csrfToken = csrfMatch[1];
      
      const acceptUrl = `${SHARELATEX_URL}/project/${invite.projectId}/invite/token/${invite.token}/accept`;
      await axios.post(acceptUrl, {
        _csrf: csrfToken
      }, {
        headers: { 
          Cookie: cookieHeader,
          'x-csrf-token': csrfToken
        }
      });
      console.log(`Clanker bot successfully accepted invite for project ${invite.projectId}`);
      
      await checkPendingInvites();
    }
  } catch (err) {
    console.error("Error processing pending invite:", err.message);
  }
}

export async function getCompileLog(projectId) {
  if (!projectId) return '';
  try {
    const compilesDir = '/var/lib/overleaf/data/compiles';
    const entries = await fs.readdir(compilesDir).catch(() => []);
    const matchingDirs = entries.filter(name => name.startsWith(`${projectId}-`));
    if (!matchingDirs || matchingDirs.length === 0) {
      return 'No compile log found (project never compiled).';
    }

    let latestLogPath = null;
    let latestMtime = 0;

    for (const dir of matchingDirs) {
      const logPath = path.join(compilesDir, dir, 'output.log');
      try {
        const stat = await fs.stat(logPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestLogPath = logPath;
        }
      } catch (e) {
        const stdoutPath = path.join(compilesDir, dir, 'output.stdout');
        try {
          const stat = await fs.stat(stdoutPath);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestLogPath = stdoutPath;
          }
        } catch (e2) {}
      }
    }

    if (latestLogPath) {
      const content = await fs.readFile(latestLogPath, 'utf8');
      return content;
    }

    return 'No compile log file present in compile directory.';
  } catch (err) {
    console.error(`Failed to fetch compile log for project ${projectId}:`, err.message);
    return `Error reading compile log: ${err.message}`;
  }
}

