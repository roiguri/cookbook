import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SLICES,
  getSliceById,
  getSlicesByWave,
  validateDag,
} from '../../../factory/orchestrator/dag.mjs';
import { RunLedger } from '../../../factory/orchestrator/cxdb.mjs';
import {
  checkCircuitBreakers,
  checkNoHoldoutInWorkspace,
} from '../../../factory/orchestrator/guards.mjs';
import { checkMobileArchitecture } from '../../../factory/orchestrator/inner-gate.mjs';

describe('Software Factory Orchestrator (Phase 4)', () => {
  test('vertical-slice DAG covers all 12 slices and is strictly acyclic across Waves 1A-3B', () => {
    expect(SLICES).toHaveLength(12);
    const res = validateDag(SLICES);
    expect(res.valid).toBe(true);
    expect(res.topologicalOrder).toHaveLength(12);
    expect(res.topologicalOrder.indexOf('00')).toBeLessThan(res.topologicalOrder.indexOf('01'));
    expect(res.topologicalOrder.indexOf('10')).toBeLessThan(res.topologicalOrder.indexOf('06'));
    expect(res.topologicalOrder.indexOf('02')).toBeLessThan(res.topologicalOrder.indexOf('03'));
    expect(getSlicesByWave('2').map((s) => s.id)).toEqual(['02', '04', '05', '07', '08', '10']);
    expect(getSliceById('3')?.id).toBe('03');
  });

  test('validateDag rejects cyclic dependencies', () => {
    expect(() =>
      validateDag([
        { id: '00', wave: '1A', dependsOn: ['01'] },
        { id: '01', wave: '1B', dependsOn: ['00'] },
      ]),
    ).toThrow(/Cycle detected/);
  });

  test('CXDB RunLedger persists append-only JSONL trace and tracks circuit breakers', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cookbook-cxdb-'));
    try {
      const ledger = new RunLedger(tmp, { runId: 'test-run-1' });
      ledger.recordSliceStatus('00', 'building');
      ledger.recordSliceStatus('00', 'done');
      ledger.recordAndroidRound({ converged: false, aggregateScore: 88, p0ViolationCount: 1 });
      ledger.recordIosRun({ converged: true, aggregateScore: 98, p0ViolationCount: 0 });

      const entries = ledger.readEntries();
      expect(entries.length).toBe(4);

      const reloaded = new RunLedger(tmp);
      expect(reloaded.state.counters.convergenceRounds).toBe(1);
      expect(reloaded.state.counters.iosCiRuns).toBe(1);
      expect(reloaded.state.slices['00'].status).toBe('done');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('hard circuit breakers trip at MAX_CONVERGENCE_ROUNDS, MAX_IOS_CI_RUNS, and MAX_SLICE_RETRIES', () => {
    expect(checkCircuitBreakers({ convergenceRounds: 2, iosCiRuns: 0, sliceRetries: {} }).ok).toBe(
      true,
    );
    expect(
      checkCircuitBreakers({ convergenceRounds: 10, iosCiRuns: 0, sliceRetries: {} }).breaker,
    ).toBe('MAX_CONVERGENCE_ROUNDS');
    expect(
      checkCircuitBreakers({ convergenceRounds: 1, iosCiRuns: 3, sliceRetries: {} }).breaker,
    ).toBe('MAX_IOS_CI_RUNS');
    expect(
      checkCircuitBreakers({ convergenceRounds: 1, iosCiRuns: 0, sliceRetries: { '04': 4 } })
        .breaker,
    ).toBe('MAX_SLICE_RETRIES');
  });

  test('workspace has zero holdout leakage and mobile architecture check passes cleanly', () => {
    const root = process.cwd();
    expect(checkNoHoldoutInWorkspace(root).ok).toBe(true);
    expect(checkMobileArchitecture(root).ok).toBe(true);
  });
});
