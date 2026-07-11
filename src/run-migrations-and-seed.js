const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const logFile = path.join(__dirname, '..', 'migration-log.txt');
const backendDir = path.join(__dirname, '..');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

// Clear log file and print initial header
fs.writeFileSync(logFile, `=== Async Migration & Seed Run: ${new Date().toISOString()} ===\n`, 'utf8');

function runCommand(command, name) {
  return new Promise((resolve, reject) => {
    log(`\n--- Starting: ${name} (${command}) ---`);
    const proc = exec(command, { cwd: backendDir });

    proc.stdout.on('data', (data) => {
      fs.appendFileSync(logFile, data.toString(), 'utf8');
      console.log(`[${name} STDOUT] ${data.trim()}`);
    });

    proc.stderr.on('data', (data) => {
      fs.appendFileSync(logFile, `[ERR] ${data.toString()}`, 'utf8');
      console.error(`[${name} STDERR] ${data.trim()}`);
    });

    proc.on('close', (code) => {
      log(`\n--- Finished: ${name} with exit code ${code} ---`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${name} failed with code ${code}`));
      }
    });
  });
}

async function runAll() {
  try {
    await runCommand('npx prisma db push', 'Prisma DB Push');
    await runCommand('node prisma/seed.js', 'Prisma Seed');
    await runCommand('node scratch-db-test.js', 'Prisma DB Test');
    log('\n=== All DB setup commands finished successfully ===');
  } catch (err) {
    log(`\n❌ DB Setup execution failed: ${err.message}`);
  }
}

// Run asynchronously so we don't block the main Node process startup
runAll();
