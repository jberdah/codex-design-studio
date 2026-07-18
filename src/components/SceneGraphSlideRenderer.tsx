import type { CSSProperties } from "react";
import type { SlideDocument, SlideShapeNode } from "@/domain/artifacts";
import { createSlideRenderModel, type SlideRenderNode } from "@/domain/slide-rendering";

export interface SceneGraphSlideRendererProps {
  document: SlideDocument;
  slideId: string;
  className?: string;
}

function frameStyle(item: SlideRenderNode): CSSProperties {
  const { node, framePercent } = item;
  return {
    position: "absolute",
    left: `${framePercent.left}%`,
    top: `${framePercent.top}%`,
    width: `${framePercent.width}%`,
    height: `${framePercent.height}%`,
    opacity: node.opacity,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center",
    overflow: node.type === "text" || node.type === "media" ? "hidden" : "visible",
    pointerEvents: "none"
  };
}

function shape(node: SlideShapeNode) {
  const width = Math.max(node.frame.width, 1);
  const height = Math.max(node.frame.height, 1);
  const common = { fill: node.fill ?? "none", stroke: node.stroke ?? "none", vectorEffect: "non-scaling-stroke" as const };
  if (node.shape === "ellipse") return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common}/>;
  if (node.shape === "line") return <line x1={0} y1={0} x2={width} y2={height} {...common}/>;
  if (node.shape === "path" && node.path) return <path d={node.path} {...common}/>;
  return <rect x={0} y={0} width={width} height={height} {...common}/>;
}

function previewableImage(uri: string) {
  return /^(?:data:image\/(?:png|jpeg|webp);base64,|blob:|https?:\/\/|\/)/i.test(uri);
}

/** Read-only, resolution-independent renderer for the physical slide scene graph. */
export function SceneGraphSlideRenderer({ document, slideId, className = "" }: SceneGraphSlideRendererProps) {
  const model = createSlideRenderModel(document, slideId);
  if (!model) return <div role="alert">Slide {slideId} is unavailable.</div>;
  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: `${model.dimensions.width}/${model.dimensions.height}`,
    overflow: "hidden",
    containerType: "inline-size",
    background: "white"
  };
  return <div className={`scene-graph-slide ${className}`.trim()} style={containerStyle} data-slide-id={slideId} data-render-model="physical-scene-graph" aria-label={`${model.name} preview`}>
    {model.nodes.map((item) => {
      const { node } = item;
      if (node.type === "text") {
        const textStyle: CSSProperties = {
          ...frameStyle(item),
          color: node.style?.color,
          fontFamily: node.style?.fontFamily,
          fontSize: node.style?.fontSize ? `${node.style.fontSize / model.dimensions.width * 100}cqw` : undefined,
          fontWeight: node.style?.fontWeight,
          lineHeight: node.style?.lineHeight,
          letterSpacing: node.style?.letterSpacing ? `${node.style.letterSpacing / model.dimensions.width * 100}cqw` : undefined,
          textAlign: node.style?.align,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word"
        };
        return <div key={node.id} data-node-id={node.id} data-node-type={node.type} style={textStyle}>{node.text}</div>;
      }
      if (node.type === "shape") return <svg key={node.id} data-node-id={node.id} data-node-type={node.type} style={frameStyle(item)} viewBox={`0 0 ${Math.max(node.frame.width, 1)} ${Math.max(node.frame.height, 1)}`} preserveAspectRatio="none" aria-hidden="true">{shape(node)}</svg>;
      const mediaStyle: CSSProperties = { width: "100%", height: "100%", objectFit: node.fit ?? "fill", display: "block" };
      return <div key={node.id} data-node-id={node.id} data-node-type={node.type} style={frameStyle(item)}>
        {node.mediaType === "image" && previewableImage(node.source.uri) ? <img src={node.source.uri} alt={node.altText} style={mediaStyle} draggable={false}/> : <div role="img" aria-label={node.altText} style={{ ...mediaStyle, display: "grid", placeItems: "center", background: "#e7e5ea", color: "#5d5964", fontSize: "2cqw" }}>{node.mediaType}</div>}
      </div>;
    })}
  </div>;
}
