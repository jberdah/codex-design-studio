import type { SlideDocument } from "@/domain/artifacts";
import type { DesignTokens, SlideSpec } from "@/domain/types";
import { SceneGraphSlideRenderer } from "./SceneGraphSlideRenderer";

export function SlidePreview({ slide, tokens, brandName, index, active, onClick, document }: { slide: SlideSpec; tokens: DesignTokens; brandName: string; index: number; active: boolean; onClick: () => void; document?: SlideDocument }) {
  const scene = document?.slides.find((candidate) => candidate.id === slide.id);
  const style = { "--p": tokens.colors.primary, "--s": tokens.colors.secondary, "--a": tokens.colors.accent, "--bg": tokens.colors.background, "--text": tokens.colors.text, "--display": tokens.typography.display, "--body": tokens.typography.body, aspectRatio: scene && document ? `${document.dimensions.width}/${document.dimensions.height}` : undefined } as React.CSSProperties;
  return <button type="button" className={`slide-preview ${slide.type} ${active ? "active" : ""}`} style={style} onClick={onClick} aria-label={`Open slide ${index + 1}`}>
    {scene && document && <SceneGraphSlideRenderer document={document} slideId={scene.id}/>}
    {!scene && <>
    <div className="slide-top"><strong>{brandName.toUpperCase()}</strong><span>0{index + 1}</span></div>
    {slide.type === "cover" && <><div className="slide-orb"/><div className="slide-copy"><small>{slide.eyebrow}</small><h3>{slide.title}</h3><p>{slide.body}</p></div></>}
    {slide.type === "value" && <><div className="slide-copy"><small>{slide.eyebrow}</small><h3>{slide.title}</h3><ol>{slide.bullets?.map((bullet) => <li key={bullet}>{bullet}</li>)}</ol></div><div className="slide-art">From signal<br/>to action</div></>}
    {slide.type === "metrics" && <><div className="slide-copy wide"><small>{slide.eyebrow}</small><h3>{slide.title}</h3><div className="slide-metrics">{slide.metrics?.map((metric) => <div key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}</div></div></>}
    </>}
  </button>;
}
