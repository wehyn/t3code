import type { ThreadId } from "@t3tools/contracts";
import type { RunGraphNode } from "@t3tools/client-runtime/state/run-graph";
import { XIcon } from "lucide-react";
import { Button } from "../ui/button";

export function RunGraphNodeDetails(props: {
  readonly node: Extract<RunGraphNode, { readonly kind: "agent" }>;
  readonly onOpenChildThread: (threadId: ThreadId) => void;
  readonly onClose: () => void;
}) {
  const childThreadId = props.node.childThreadId;

  return (
    <section
      aria-label={`${props.node.label} details`}
      className="mx-1.5 space-y-2 rounded-xl border border-border/65 bg-muted/15 p-3"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-2 bg-background">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium">{props.node.label}</h4>
          <p className="text-xs text-muted-foreground">{props.node.statusLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {childThreadId !== null ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => props.onOpenChildThread(childThreadId)}
            >
              Open child thread
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Close agent details"
            onClick={props.onClose}
          >
            <XIcon aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {props.node.providerInstanceId ? <p>Provider {props.node.providerInstanceId}</p> : null}
        {props.node.model ? <p>Model {props.node.model}</p> : null}
        {props.node.prompt ? (
          <div>
            <h5 className="mb-1 font-medium">Prompt</h5>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {props.node.prompt}
            </p>
          </div>
        ) : null}
        {props.node.progress ? (
          <div>
            <h5 className="mb-1 font-medium">Progress</h5>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {props.node.progress}
            </p>
          </div>
        ) : null}
        {props.node.result ? (
          <div>
            <h5 className="mb-1 font-medium">Result</h5>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {props.node.result}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
