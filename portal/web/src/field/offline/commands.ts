/* Commands, not rows (brief §13.3). Every write the field app makes is one of the sync ops in the contract; it is saved
   locally with its media and a placeholder record in one transaction, shown as Pending, and pushed by sync.ts.
   The client never writes a status: it sends `triage`, `complete`, `verify`… and the server decides. */
import type {
  ActionCompleteRequest, ActionRequestCreate, ActionVerifyRequest, Answer, Me, MediaRef, ObservationCreate, RunStartRequest, RunSubmitRequest, SyncOp, TemplateVersion, TriageRequest,
} from "../../shared/types";
import { deviceId, uuid } from "../../shared/storage";
import { allOutbox, enqueue, getMeta, type LocalObservation, type LocalRun, type OutboxItem } from "./db";
import { kick } from "./sync";

export interface Bytes { ref: MediaRef; blob: Blob }

/** The command that created a record which has no server id yet (so the new command must wait for it). */
async function dependencyFor(targetId: string): Promise<string[]> {
  const idmap = await getMeta<Record<string, string>>("idmap", {});
  if (idmap[targetId]) return [];
  const items = await allOutbox();
  const creator = items.find((x) => x.entityClientUuid === targetId && (x.op === "create" || x.op === "start") && x.status !== "synced");
  return creator ? [creator.commandId] : [];
}

async function send(op: SyncOp, extra: { entityClientUuid: string; title: string; targetId: string; media?: Bytes[]; fixRoute?: string | null; observation?: LocalObservation; run?: LocalRun; baseVersion?: number | null; dependsOn?: string[] }): Promise<OutboxItem> {
  const item = await enqueue({
    commandId: uuid(), entityType: op.entityType, op: op.op, payload: op.payload, entityClientUuid: extra.entityClientUuid,
    capturedAt: (op.payload as { capturedAt?: string }).capturedAt ?? new Date().toISOString(), deviceId: deviceId(), dependsOn: extra.dependsOn ?? [],
    title: extra.title, targetId: extra.targetId, fixRoute: extra.fixRoute ?? null, media: extra.media, observation: extra.observation, run: extra.run, baseVersion: extra.baseVersion ?? null,
  });
  kick();
  return item;
}

/* ---------------------------------------------------------------- observations */
export async function submitObservation(create: ObservationCreate, media: Bytes[], me: Me | null, areaName: { en: string } | null, title: string): Promise<OutboxItem> {
  const now = new Date().toISOString();
  const observation: LocalObservation = {
    id: create.clientUuid, clientUuid: create.clientUuid, caseNo: "", siteId: create.siteId, areaId: create.areaId, areaName, type: create.type, categoryCodes: create.categoryCodes,
    description: create.description, status: "submitted", riskBand: null, imminentDanger: create.imminentDanger, fixedOnSpot: create.fixedOnSpot, anonymous: create.anonymous,
    channel: create.channel, reporterName: create.anonymous ? null : me?.name ?? null, capturedAt: create.capturedAt, receivedAt: now, triagedAt: null, closedAt: null, thumbUrl: null,
    openActions: 0, totalActions: 0, criticalAckedAt: null, mine: true, version: 0, updatedAt: now, local: true,
  };
  const item = await send({ entityType: "observation", op: "create", payload: create }, { entityClientUuid: create.clientUuid, title, targetId: create.clientUuid, media, observation, fixRoute: `/report?fix=` });
  observation.commandId = item.commandId;
  return item;
}
export async function triageObservation(observationId: string, req: TriageRequest, title: string): Promise<OutboxItem> {
  return send({ entityType: "observation", op: "triage", payload: { observationId, ...req } }, { entityClientUuid: req.clientUuid, title, targetId: observationId, dependsOn: await dependencyFor(observationId), fixRoute: `/o/${observationId}` });
}
export async function ackCritical(observationId: string, title: string): Promise<OutboxItem> {
  return send({ entityType: "observation", op: "ack_critical", payload: { observationId, capturedAt: new Date().toISOString() } }, { entityClientUuid: uuid(), title, targetId: observationId, dependsOn: await dependencyFor(observationId), fixRoute: `/o/${observationId}` });
}
export async function commentObservation(observationId: string, body: string, title: string): Promise<OutboxItem> {
  const clientUuid = uuid();
  return send({ entityType: "observation", op: "comment", payload: { observationId, clientUuid, body, capturedAt: new Date().toISOString() } }, { entityClientUuid: clientUuid, title, targetId: observationId, dependsOn: await dependencyFor(observationId), fixRoute: `/o/${observationId}` });
}
export async function replyObservation(observationId: string, body: string, media: Bytes[], title: string): Promise<OutboxItem> {
  const clientUuid = uuid();
  return send({ entityType: "observation", op: "reply", payload: { observationId, clientUuid, body, media: media.map((m) => m.ref), capturedAt: new Date().toISOString() } }, { entityClientUuid: clientUuid, title, targetId: observationId, media, dependsOn: await dependencyFor(observationId), fixRoute: `/o/${observationId}` });
}

/* ---------------------------------------------------------------- actions */
export async function startAction(actionId: string, title: string): Promise<OutboxItem> {
  return send({ entityType: "action", op: "start", payload: { actionId, capturedAt: new Date().toISOString() } }, { entityClientUuid: uuid(), title, targetId: actionId, dependsOn: await dependencyFor(actionId), fixRoute: `/a/${actionId}` });
}
export async function completeAction(actionId: string, req: ActionCompleteRequest, media: Bytes[], title: string): Promise<OutboxItem> {
  return send({ entityType: "action", op: "complete", payload: { actionId, ...req } }, { entityClientUuid: req.clientUuid, title, targetId: actionId, media, dependsOn: await dependencyFor(actionId), fixRoute: `/a/${actionId}` });
}
export async function verifyAction(actionId: string, req: ActionVerifyRequest, media: Bytes[], title: string): Promise<OutboxItem> {
  return send({ entityType: "action", op: "verify", payload: { actionId, ...req } }, { entityClientUuid: req.clientUuid, title, targetId: actionId, media, dependsOn: await dependencyFor(actionId), fixRoute: `/a/${actionId}` });
}
export async function requestOnAction(actionId: string, req: ActionRequestCreate, title: string): Promise<OutboxItem> {
  return send({ entityType: "action", op: "request", payload: { actionId, ...req } }, { entityClientUuid: req.clientUuid, title, targetId: actionId, dependsOn: await dependencyFor(actionId), fixRoute: `/a/${actionId}` });
}
export async function commentAction(actionId: string, body: string, media: Bytes[], title: string): Promise<OutboxItem> {
  const clientUuid = uuid();
  return send({ entityType: "action", op: "comment", payload: { actionId, clientUuid, body, media: media.map((m) => m.ref), capturedAt: new Date().toISOString() } }, { entityClientUuid: clientUuid, title, targetId: actionId, media, dependsOn: await dependencyFor(actionId), fixRoute: `/a/${actionId}` });
}

/* ---------------------------------------------------------------- inspection runs */
export async function startRun(req: RunStartRequest, template: TemplateVersion, me: Me | null, title: string): Promise<OutboxItem> {
  const now = new Date().toISOString();
  const run: LocalRun = {
    id: req.clientUuid, clientUuid: req.clientUuid, caseNo: "", templateVersionId: template.id, templateCode: template.code, templateName: template.name, siteId: req.siteId,
    areaId: req.areaId ?? null, assetId: req.assetId ?? null, scheduleId: req.scheduleId ?? null, trigger: req.trigger ?? "spot", dueAt: null, startedAt: req.startedAt, completedAt: null,
    status: "in_progress", inspectorUserId: me?.id ?? null, inspectorName: me?.name ?? null, scorePct: null, result: null, tagStatus: null, failedCount: 0, actionsRaised: 0, version: 0, updatedAt: now, local: true,
  };
  const item = await send({ entityType: "inspection_run", op: "start", payload: req }, { entityClientUuid: req.clientUuid, title, targetId: req.clientUuid, run, fixRoute: `/inspections/runs/${req.clientUuid}` });
  return item;
}
export async function saveAnswers(runId: string, answers: Answer[], media: Bytes[], title: string): Promise<OutboxItem> {
  return send({ entityType: "inspection_run", op: "answers", payload: { runId, answers } }, { entityClientUuid: uuid(), title, targetId: runId, media, dependsOn: await dependencyFor(runId), fixRoute: `/inspections/runs/${runId}` });
}
export async function submitRun(runId: string, req: RunSubmitRequest, media: Bytes[], title: string, after?: string[]): Promise<OutboxItem> {
  const deps = [...(await dependencyFor(runId)), ...(after ?? [])];
  return send({ entityType: "inspection_run", op: "submit", payload: { runId, ...req } }, { entityClientUuid: req.clientUuid, title, targetId: runId, media, dependsOn: deps, fixRoute: `/inspections/runs/${runId}` });
}
