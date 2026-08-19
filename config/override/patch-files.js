import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const headerImageUrl = process.env.OVERLEAF_HEADER_IMAGE_URL;
if (headerImageUrl) {
  const destPath = '/overleaf/services/web/public/stylesheets/custom-logo.svg';
  try {
    const client = headerImageUrl.startsWith('https') ? https : http;
    client.get(headerImageUrl, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          console.log('Successfully cached custom-logo.svg locally');
        });
      }
    }).on('error', (err) => {
      console.error('Failed to download custom logo:', err.message);
    });
  } catch (err) {
    console.error('Error initiating logo download:', err.message);
  }
}

const patches = [
  {
    filePath: '/overleaf/services/web/app/views/layout-base.pug',
    check: '/stylesheets/custom.css',
    target: "link(rel='stylesheet' href=buildCssPath() id='main-stylesheet')",
    replacement: "link(rel='stylesheet' href=buildCssPath() id='main-stylesheet')\n\t\tlink(rel='stylesheet' href='/stylesheets/custom.css?v=clanker1')\n\t\tstyle :root { --custom-logo-url: url('/stylesheets/custom-logo.svg'); }"
  },
  {
    filePath: '/overleaf/services/web/app/src/Features/Project/ProjectCreationHandler.mjs',
    check: 'CLANKER_USER_ID',
    target: 'await project.save()',
    replacement: `  const clankerUserId = process.env.CLANKER_USER_ID
  if (clankerUserId && clankerUserId !== ownerId.toString()) {
    project.collaberator_refs.push(new ObjectId(clankerUserId))
  }

  await project.save()`
  },
  {
    filePath: '/overleaf/services/web/app/src/Features/Collaborators/CollaboratorsInviteHandler.mjs',
    check: "client('clanker')",
    target: "import _ from 'lodash'",
    replacement: "import _ from 'lodash'\nimport RedisWrapper from '../../infrastructure/RedisWrapper.mjs'\nconst redisClient = RedisWrapper.client('clanker')"
  },
  {
    filePath: '/overleaf/services/web/app/src/Features/Collaborators/CollaboratorsInviteHandler.mjs',
    check: 'CLANKER_EMAIL',
    target: "return _.pick(invite, ['_id', 'email', 'privileges'])\n  }",
    replacement: `    const clankerEmail = process.env.CLANKER_EMAIL
    if (clankerEmail && email === clankerEmail) {
      try {
        await redisClient.lpush('clanker:pending_invites', JSON.stringify({ projectId, token }))
      } catch (err) {
        logger.error({ err, projectId }, 'failed to push clanker pending invite to redis')
      }
    }

    return _.pick(invite, ['_id', 'email', 'privileges'])\n  }`
  }
];

for (const patch of patches) {
  try {
    if (!fs.existsSync(patch.filePath)) {
      console.warn(`File not found: ${patch.filePath}. Skipping patch.`);
      continue;
    }
    let content = fs.readFileSync(patch.filePath, 'utf8');
    if (content.includes(patch.check || patch.replacement)) {
      console.log(`Patch already applied to ${patch.filePath} (found ${patch.check})`);
      continue;
    }
    if (!content.includes(patch.target)) {
      console.error(`Target string not found in ${patch.filePath}: "${patch.target}"`);
      continue;
    }
    content = content.replace(patch.target, patch.replacement);
    fs.writeFileSync(patch.filePath, content, 'utf8');
    console.log(`Successfully patched ${patch.filePath}`);
  } catch (err) {
    console.error(`Error patching ${patch.filePath}:`, err.message);
  }
}
