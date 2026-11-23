/**
 * CXDB-Style Append-Only Run Trace Ledger (`factory/runs/<run-id>/`).
 *
 * Records every orchestrator state transition, slice build, visible gate run,
 * AI-to-AI review verdict, Android/iOS convergence round, and circuit breaker
 * counter into an append-only `ledger.jsonl` plus materialized `state.json`.
 */
import fs from 'node:fs';
import path from 'node:path';

export class RunLedger {
  constructor(runDir, { runId = path.basename(runDir), branch = 'native-mobile' } = {}) {
    this.runDir = path.resolve(runDir);
    this.ledgerPath = path.join(this.runDir, 'ledger.jsonl');
    this.statePath = path.join(this.runDir, 'state.json');
    fs.mkdirSync(this.runDir, { recursive: true });

    if (fs.existsSync(this.statePath)) {
      this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } else {
      this.state = {
        runId,
        branch,
        startedAt: new Date().toISOString(),
        status: 'running',
        slices: {},
        androidRounds: [],
        iosRuns: [],
        counters: {
          sliceRetries: {},
          convergenceRounds: 0,
          iosCiRuns: 0,
        },
        stagingRelease: null,
        circuitBreaker: null,
      };
      this.persistState();
    }
  }

  append(eventType, payload = {}) {
    const entry = {
      ts: new Date().toISOString(),
      event: eventType,
      ...payload,
    };
    fs.appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.persistState();
    return entry;
  }

  persistState() {
    this.state.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  recordSliceStatus(sliceId, status, detail = {}) {
    const prev = this.state.slices[sliceId] || { attempts: 0 };
    const attempts = status === 'building' ? prev.attempts + 1 : prev.attempts;
    this.state.slices[sliceId] = { ...prev, status, attempts, ...detail };
    this.state.counters.sliceRetries[sliceId] = Math.max(0, attempts - 1);
    return this.append('slice_state', { sliceId, status, attempts, ...detail });
  }

  recordAndroidRound(roundResult) {
    this.state.counters.convergenceRounds += 1;
    const entry = {
      round: this.state.counters.convergenceRounds,
      ts: new Date().toISOString(),
      ...roundResult,
    };
    this.state.androidRounds.push(entry);
    return this.append('android_convergence_round', entry);
  }

  recordIosRun(iosResult) {
    this.state.counters.iosCiRuns += 1;
    const entry = {
      runIndex: this.state.counters.iosCiRuns,
      ts: new Date().toISOString(),
      ...iosResult,
    };
    this.state.iosRuns.push(entry);
    return this.append('ios_verification_run', entry);
  }

  recordStagingRelease(releaseInfo) {
    this.state.stagingRelease = { ts: new Date().toISOString(), ...releaseInfo };
    return this.append('staging_release', releaseInfo);
  }

  tripCircuitBreaker(reason, detail = {}) {
    this.state.status = 'halted_circuit_breaker';
    this.state.circuitBreaker = { ts: new Date().toISOString(), reason, detail };
    return this.append('circuit_breaker_tripped', { reason, detail });
  }

  markCompleted(summary = {}) {
    this.state.status = 'completed';
    this.state.completedAt = new Date().toISOString();
    return this.append('run_completed', summary);
  }

  readEntries() {
    if (!fs.existsSync(this.ledgerPath)) return [];
    return fs
      .readFileSync(this.ledgerPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}
