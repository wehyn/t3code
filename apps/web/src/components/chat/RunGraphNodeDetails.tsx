import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import {
  turnItemDetailRevision,
  turnItemNeedsDetailFetch,
  turnItemOutputText,
  toolCallLines,
} from "@t3tools/client-runtime/work-log/item-detail";
import * as DateTime from "effect/DateTime";
import { useTurnItemDetail } from "../../state/queries";
import type {
  ThreadStructure,
  ThreadStructureTurnItem,
} from "@t3tools/client-runtime/state/models";
import type { RunGraphNode } from "@t3tools/client-runtime/state/run-graph";
import { Button } from "../ui/button";

type ToolItem = ThreadStructureTurnItem & {
  readonly type:
    | "command_execution"
    | "dynamic_tool"
    | "file_change"
    | "file_search"
    | "web_search";
};

function isToolItem(item: ThreadStructureTurnItem): item is ToolItem {
  return (
    item.type === "command_execution" ||
    item.type === "dynamic_tool" ||
    item.type === "file_change" ||
    item.type === "file_search" ||
    item.type === "web_search"
  );
}

function formatObservedTime(value: DateTime.Utc | null): string {
  return value === null ? "Not observed" : new Date(DateTime.toEpochMillis(value)).toLocaleString();
}

function ToolInput({ item }: { readonly item: ToolItem }) {
  if (item.type === "command_execution") {
    return (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{item.input}</pre>
    );
  }
  if (item.type === "dynamic_tool") {
    const lines = toolCallLines({ args: item.input });
    if (lines.args) {
      return (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          {lines.args.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="m-0 min-w-0 whitespace-pre-wrap break-words">{value}</dd>
            </div>
          ))}
        </dl>
      );
    }
    return lines.argsText ? (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{lines.argsText}</pre>
    ) : (
      <p className="text-muted-foreground">No input.</p>
    );
  }
  if (item.type === "file_change") return <p>{item.fileName}</p>;
  if (item.type === "file_search") return <p>{item.pattern || "File search"}</p>;
  return <p>{item.patterns?.join(", ") || "Web search"}</p>;
}

function RunGraphToolItemDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ToolItem;
}) {
  const needsFetch = turnItemNeedsDetailFetch(props.item);
  const detail = useTurnItemDetail(
    needsFetch
      ? {
          environmentId: props.environmentId,
          threadId: props.item.threadId,
          itemId: props.item.id,
          revision: turnItemDetailRevision(props.item),
        }
      : null,
  );
  const fetchedItem = detail.data?.item;
  const hasFetchedItem = fetchedItem?.type === props.item.type;
  const item = hasFetchedItem ? fetchedItem : props.item;
  const unavailable = needsFetch && !detail.isPending && !hasFetchedItem;
  const output = turnItemOutputText(item);

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-2 text-xs">
      <div>
        <h5 className="mb-1 font-medium">Input</h5>
        <ToolInput item={item} />
      </div>
      <div>
        <h5 className="mb-1 font-medium">Output</h5>
        {output ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
            {output}
          </pre>
        ) : detail.isPending && needsFetch ? (
          <p className="text-muted-foreground italic">Loading detail…</p>
        ) : unavailable ? (
          <p className="text-destructive">Output detail is unavailable.</p>
        ) : (
          <p className="text-muted-foreground">No output.</p>
        )}
      </div>
    </div>
  );
}

function RunGraphItemDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ThreadStructureTurnItem;
}) {
  if (props.item.type === "error") {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        {props.item.failure.message || "Failure detail is unavailable."}
      </div>
    );
  }
  if (props.item.type === "file_change") {
    return (
      <div className="space-y-2 rounded-md border border-border/60 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{props.item.fileName}</span>
          {props.item.additions !== undefined || props.item.deletions !== undefined ? (
            <span>
              <span className="text-diff-addition">+{props.item.additions ?? 0}</span>{" "}
              <span className="text-diff-deletion">-{props.item.deletions ?? 0}</span>
            </span>
          ) : null}
        </div>
        {props.item.diffStr ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
            {props.item.diffStr}
          </pre>
        ) : null}
      </div>
    );
  }
  if (isToolItem(props.item)) {
    return <RunGraphToolItemDetails environmentId={props.environmentId} item={props.item} />;
  }
  return <p className="text-xs text-muted-foreground">Linked activity detail is unavailable.</p>;
}

export function RunGraphNodeDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly projection: ThreadStructure;
  readonly node: RunGraphNode;
  readonly onOpenChildThread: (threadId: ThreadId) => void;
}) {
  const itemById = new Map(props.projection.turnItems.map((item) => [item.id, item]));
  const itemIds =
    props.node.kind === "activity"
      ? [...new Set([...props.node.turnItemIds, ...props.node.errorItemIds])]
      : [];
  const items = itemIds.flatMap((itemId: TurnItemId) => {
    const item = itemById.get(itemId);
    return item === undefined ? [] : [item];
  });
  const childThreadId = props.node.kind === "agent" ? props.node.childThreadId : null;

  return (
    <section
      aria-label={`${props.node.label} details`}
      className="mx-1.5 mt-2 space-y-2 rounded-xl border border-border/65 bg-muted/15 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium">{props.node.label}</h4>
          <p className="text-xs text-muted-foreground">{props.node.statusLabel}</p>
        </div>
        {childThreadId !== null ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => props.onOpenChildThread(childThreadId)}
          >
            Open child thread
          </Button>
        ) : null}
      </div>

      {props.node.kind === "agent" ? (
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
      ) : (
        <div className="space-y-2 text-xs">
          <p>Observed start {formatObservedTime(props.node.startedAt)}</p>
          <p>Observed completion {formatObservedTime(props.node.completedAt)}</p>
          {items.length > 0 ? (
            <div className="space-y-2">
              {items.map((item) => (
                <RunGraphItemDetails
                  key={item.id}
                  environmentId={props.environmentId}
                  item={item}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No linked activity detail is available.</p>
          )}
        </div>
      )}
    </section>
  );
}
