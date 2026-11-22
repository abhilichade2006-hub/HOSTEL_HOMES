const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const [name, url] of [['missing production configuration', ''], ['unreachable PostgreSQL', 'postgresql://test:test@127.0.0.1:1/test']]) {
  test(`startup fails safely for ${name} without creating a local database`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-startup-test-'));
    try {
      for (const file of ['server.js','database.js','email.js']) fs.copyFileSync(path.join(__dirname,'..',file),path.join(dir,file));
      const result = spawnSync(process.execPath, ['server.js'], { cwd:dir, encoding:'utf8', timeout:20000, env:{...process.env,NODE_PATH:path.join(__dirname,'..','node_modules'),DATABASE_URL:url,NODE_ENV:'production',BREVO_API_KEY:'',EMAIL_FROM:''} });
      assert.equal(result.status,1);
      assert.equal(fs.existsSync(path.join(dir,'hostel-homes.sqlite')),false);
      assert.match(result.stderr,/Could not start Hostel Homes/);
      assert.equal(result.stderr.includes('postgresql://'),false);
    } finally {
      if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('hostel-startup-test-'))throw Error('Unexpected cleanup target');
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
}
