import { firestore } from "../src/config/firebaseAdmin";
import { buildInvitationSearchPrefixes } from "../src/services/invitationSearch.service";
import { mapInvitationDocument } from "../src/services/invitations.service";

const mode = process.argv[2];
if (mode !== "--dry-run" && mode !== "--apply") {
  throw new Error("Uso: npm run backfill:invitation-search -- --dry-run | --apply");
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

async function main(): Promise<void> {
  const snapshot = await firestore.collection("invitations").get();
  const pending: Array<{ ref: FirebaseFirestore.DocumentReference; update: Record<string, unknown> }> = [];
  let unchanged = 0;
  let errors = 0;

  for (const document of snapshot.docs) {
    try {
      const raw = document.data();
      const invitation = mapInvitationDocument(document.id, raw);
      const expected = buildInvitationSearchPrefixes(
        invitation.id,
        invitation.displayName,
        invitation.guests,
      );
      const update: Record<string, unknown> = {};
      if (!sameStrings(raw.searchPrefixes, expected)) update.searchPrefixes = expected;
      if (raw.isArchived === undefined) update.isArchived = false;
      if (Object.keys(update).length === 0) unchanged += 1;
      else pending.push({ ref: document.ref, update });
    } catch (error) {
      errors += 1;
      console.error(`[error] ${document.id}:`, error instanceof Error ? error.message : error);
    }
  }

  let updated = 0;
  if (mode === "--apply") {
    for (let start = 0; start < pending.length; start += 400) {
      const batchItems = pending.slice(start, start + 400);
      const batch = firestore.batch();
      for (const item of batchItems) batch.update(item.ref, item.update);
      await batch.commit();
      updated += batchItems.length;
    }
  }

  console.log(JSON.stringify({
    mode: mode.slice(2),
    reviewed: snapshot.size,
    needsUpdate: pending.length,
    unchanged,
    updated,
    errors,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error("[fatal]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
