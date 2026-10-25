import { deriveRunGraph } from "@t3tools/client-runtime/state/run-graph";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { RunGraphCanvasPan, RunGraphCanvasView } from "../../runGraphCardStore";
import { useRunGraphSelection, type RunGraphSelection } from "../../runGraphSelection";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { RunGraphView } from "./RunGraphView";

interface ThreadRunGraphSectionProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly selection?: RunGraphSelection | undefined;
  readonly zoom?: number | undefined;
  readonly pan?: RunGraphCanvasPan | null | undefined;
  readonly onPanChange?: ((pan: RunGraphCanvasPan) => void) | undefined;
  readonly onViewChange?: ((view: RunGraphCanvasView) => void) | undefined;
  readonly seenSubagentKeys?: ReadonlyArray<string> | undefined;
  readonly onSubagentsSeen?: ((keys: ReadonlyArray<string>) => void) | undefined;
}

function ThreadRunGraphSectionContent(
  props: ThreadRunGraphSectionProps & {
    readonly selection: RunGraphSelection;
  },
) {
  const { selection } = props;
  const headingId = "thread-details-run-graph-heading";

  if (selection.kind === "loading" || selection.kind === "empty") {
    return (
      <ThreadDetailsSection headingId={headingId} title="Run graph" data-thread-run-graph>
        <p className="px-1.5 pb-1 text-sm text-muted-foreground">
          {selection.kind === "loading" ? "Loading run graph…" : "No runs yet."}
        </p>
      </ThreadDetailsSection>
    );
  }

  const { projection, run } = selection;
  const graph = deriveRunGraph({ projection, runId: run.id });

  return (
    <section
      aria-labelledby={headingId}
      className="relative h-full min-h-0 min-w-0"
      data-thread-run-graph
    >
      <h3
        id={headingId}
        className="pointer-events-none absolute top-3 left-3 z-10 text-2xs font-medium text-muted-foreground select-none"
      >
        Run graph
      </h3>
      <RunGraphView
        key={`${props.environmentId}:${props.threadId}:${run.id}`}
        graph={graph}
        environmentId={props.environmentId}
        runOrdinal={run.ordinal}
        zoom={props.zoom ?? 1}
        pan={props.pan ?? null}
        onPanChange={props.onPanChange}
        onViewChange={props.onViewChange}
        seenSubagentKeys={props.seenSubagentKeys ?? []}
        onSubagentsSeen={props.onSubagentsSeen}
      />
    </section>
  );
}

function ThreadRunGraphSectionWithProjection(props: ThreadRunGraphSectionProps) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const selection = useRunGraphSelection(ref);
  return <ThreadRunGraphSectionContent {...props} selection={selection} />;
}

export function ThreadRunGraphSection(props: ThreadRunGraphSectionProps) {
  return props.selection === undefined ? (
    <ThreadRunGraphSectionWithProjection {...props} />
  ) : (
    <ThreadRunGraphSectionContent {...props} selection={props.selection} />
  );
}
