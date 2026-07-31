import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

type ForceNode = {
  id: string;
  label: string;
  color: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

type ForceLink = { source: string; target: string };

const NODES: ForceNode[] = [
  { id: "wmon", label: "WMON", color: "#ccff00", x: 140, y: 115 },
  { id: "erc20", label: "ERC-20 / native MON", color: "#69d7ff", x: 315, y: -135 },
  { id: "erc721", label: "ERC-721", color: "#ffbe55", x: 390, y: 70 },
  { id: "erc1155", label: "ERC-1155", color: "#b99aff", x: 565, y: -55 },
  { id: "kuru", label: "Kuru", color: "#54e7ae", x: 545, y: 170 },
  { id: "pancake", label: "PancakeSwap V2 / V3", color: "#ff7a94", x: 275, y: 205 },
];

const LINKS: ForceLink[] = [
  { source: "wmon", target: "erc20" },
  { source: "wmon", target: "erc721" },
  { source: "wmon", target: "pancake" },
  { source: "erc20", target: "erc721" },
  { source: "erc20", target: "erc1155" },
  { source: "erc721", target: "erc1155" },
  { source: "erc721", target: "kuru" },
  { source: "erc721", target: "pancake" },
  { source: "erc1155", target: "kuru" },
];

export function RouteGraph() {
  const graphRef = useRef<ForceGraph2D<ForceNode, ForceLink> | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeScaleRef = useRef(new Map<string, number>());
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [hoveredNode, setHoveredNode] = useState<ForceNode | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>(["erc721", "erc1155"]);

  const graphData = useMemo(
    // d3-force mutates link source/target into node references, so both nodes
    // and links must be fresh copies or a remount would reuse stale nodes.
    () => ({
      nodes: NODES.map((node) => ({ ...node })),
      links: LINKS.map((link) => ({ ...link })),
    }),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setActiveIds(
          [...NODES]
            .sort(() => Math.random() - 0.5)
            .slice(0, 2)
            .map((node) => node.id),
        ),
      5000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      graphData.nodes.forEach((node, index) => {
        if (node.fx != null || node.fy != null) return;
        const time = Date.now() / 1000;
        node.vx = (node.vx ?? 0) + Math.sin(time * 0.38 + index * 1.9) * 0.008;
        node.vy = (node.vy ?? 0) + Math.cos(time * 0.31 + index * 1.4) * 0.008;
      });
      graphRef.current?.d3ReheatSimulation();
    }, 180);
    return () => window.clearInterval(timer);
  }, [graphData]);

  useEffect(() => {
    const timer = window.setInterval(() => graphRef.current?.refresh(), 80);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const update = () =>
      setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canvasSize.width <= 1 || canvasSize.height <= 1) return;
    const timer = window.setTimeout(() => graphRef.current?.zoomToFit(0, 72), 250);
    return () => window.clearTimeout(timer);
  }, [canvasSize]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength(-65);
    graph.d3Force("link")?.distance(145);
    graph.d3ReheatSimulation();
  }, []);

  const paintNode = (
    node: ForceNode,
    context: CanvasRenderingContext2D,
    scale: number,
  ) => {
    const active = hoveredNode?.id === node.id || activeIds.includes(node.id);
    const targetRadius = active ? 14 : 9;
    const currentRadius = nodeScaleRef.current.get(node.id) ?? 9;
    const radius = currentRadius + (targetRadius - currentRadius) * 0.12;
    nodeScaleRef.current.set(node.id, radius);
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = node.color;
    context.shadowColor = node.color;
    context.shadowBlur = active ? 18 + 5 * Math.sin(Date.now() / 250) : 7;
    context.fill();
    context.shadowBlur = 0;
    context.font = `${Math.max(12 / scale, 5)}px Inter, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillStyle = node.color;
    context.fillText(node.label, x, y - radius - 9 / scale);
    context.restore();
  };

  return (
    <div
      aria-label="Moss 能力路徑圖"
      className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(204,255,0,0.1),transparent_4px),#0c0c0c] before:absolute before:inset-0 before:bg-[linear-gradient(#1e1e1e_1px,transparent_1px),linear-gradient(90deg,#1e1e1e_1px,transparent_1px)] before:bg-[length:28px_28px] before:opacity-55 before:content-['']"
    >
      <div
        ref={canvasRef}
        className="absolute bottom-0 right-0 top-0 z-[2] w-full sm:w-[56%]"
      >
        <ForceGraph2D
          ref={graphRef}
          width={canvasSize.width}
          height={canvasSize.height}
          graphData={graphData}
          backgroundColor="transparent"
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, context) => {
            context.fillStyle = color;
            context.beginPath();
            context.arc(node.x ?? 0, node.y ?? 0, 18, 0, Math.PI * 2);
            context.fill();
          }}
          onNodeHover={(node) => setHoveredNode(node as ForceNode | null)}
          linkColor={() => "rgba(190,190,190,.42)"}
          linkWidth={0.5}
          cooldownTicks={100}
          warmupTicks={50}
          enablePointerInteraction
          enableNodeDrag={false}
          enableZoomInteraction={false}
          enablePanInteraction={false}
        />
      </div>
      <div className="absolute bottom-4 left-4 z-[3] text-[8.5px] font-bold tracking-[0.08em] text-faint">
        <i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#ccff00]" />
        MOSS CAPABILITY GRAPH · LIVE LABELS
      </div>
    </div>
  );
}
