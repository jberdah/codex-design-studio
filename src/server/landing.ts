import type { ProjectData } from "@/domain/types";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
}[character] ?? character));

export function tokensToCss(project: ProjectData) {
  const { tokens } = project;
  return `:root {
  --brand-primary: ${tokens.colors.primary};
  --brand-secondary: ${tokens.colors.secondary};
  --brand-accent: ${tokens.colors.accent};
  --brand-background: ${tokens.colors.background};
  --brand-surface: ${tokens.colors.surface};
  --brand-text: ${tokens.colors.text};
  --font-display: ${JSON.stringify(tokens.typography.display)}, serif;
  --font-body: ${JSON.stringify(tokens.typography.body)}, sans-serif;
  --radius-card: ${tokens.shape.radiusCard}px;
  --radius-button: ${tokens.shape.radiusButton}px;
}`;
}

export function renderLandingHtml(project: ProjectData) {
  const { brand, landing } = project;
  const benefitCards = landing.benefits.map((benefit, index) => `
      <article class="benefit" data-design-id="benefit-${index + 1}" data-design-label="Benefit ${index + 1}">
        <span>0${index + 1}</span><h3>${escapeHtml(benefit.title)}</h3><p>${escapeHtml(benefit.body)}</p>
      </article>`).join("");
  const proofItems = landing.proof.map((proof, index) => `
      <div class="metric" data-design-id="metric-${index + 1}" data-design-label="Metric ${index + 1}">
        <strong>${escapeHtml(proof.value)}</strong><span>${escapeHtml(proof.label)}</span>
      </div>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(brand.name)} — ${escapeHtml(landing.headline)}</title>
<style>
${tokensToCss(project)}
*{box-sizing:border-box}body{margin:0;background:var(--brand-background);color:var(--brand-text);font-family:var(--font-body);line-height:1.5}a{text-decoration:none;color:inherit}
.page{min-height:100vh;overflow:hidden}.nav{height:80px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(24px,6vw,92px)}.brand{font-family:var(--font-display);font-size:24px;font-weight:700}.nav-links{display:flex;gap:28px;font-size:14px}.nav-cta,.button{border-radius:var(--radius-button);padding:12px 20px;background:var(--brand-primary);color:white;font-weight:700}
.hero{position:relative;min-height:650px;padding:80px clamp(24px,8vw,120px) 100px;display:grid;grid-template-columns:1.2fr .8fr;align-items:center;gap:60px}.hero:after{content:"";position:absolute;width:520px;height:520px;right:-80px;top:20px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--brand-accent),var(--brand-secondary) 48%,var(--brand-primary));filter:saturate(.85)}.hero-copy{position:relative;z-index:1}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:12px;font-weight:800;color:var(--brand-secondary)}h1{font-family:var(--font-display);font-size:clamp(52px,6.2vw,92px);line-height:.96;letter-spacing:-.055em;margin:20px 0 28px;max-width:900px}h2{font-family:var(--font-display);font-size:clamp(38px,4vw,62px);line-height:1.02;letter-spacing:-.04em}.subhead{font-size:19px;max-width:620px;color:color-mix(in srgb,var(--brand-text) 72%,transparent)}.actions{display:flex;align-items:center;gap:22px;margin-top:36px}.link-button{font-weight:700;border-bottom:1px solid currentColor}.orb-label{position:relative;z-index:1;margin-top:340px;color:white;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.section{padding:100px clamp(24px,8vw,120px)}.section-head{max-width:780px;margin-bottom:50px}.benefit-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.benefit{background:var(--brand-surface);padding:34px;border-radius:var(--radius-card);min-height:260px;border:1px solid color-mix(in srgb,var(--brand-primary) 9%,transparent)}.benefit>span{font-size:12px;color:var(--brand-secondary)}.benefit h3{font-family:var(--font-display);font-size:28px;margin:45px 0 12px}.benefit p{color:color-mix(in srgb,var(--brand-text) 70%,transparent)}
.proof{background:var(--brand-primary);color:white}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.metric{padding:38px 0;border-top:1px solid rgba(255,255,255,.25)}.metric strong{display:block;font-family:var(--font-display);font-size:64px;color:var(--brand-accent)}.metric span{font-size:14px}.final{display:flex;align-items:center;justify-content:space-between;gap:40px}.final h2{max-width:760px}.footer{padding:35px clamp(24px,8vw,120px);display:flex;justify-content:space-between;border-top:1px solid color-mix(in srgb,var(--brand-primary) 15%,transparent);font-size:13px}
[data-design-id]{outline:2px solid transparent;outline-offset:4px;transition:outline-color .15s,filter .15s}[data-design-id]:hover{outline-color:#7c5cff;cursor:pointer;filter:brightness(.98)}[data-selected="true"]{outline:3px solid #7c5cff!important}.selection-tag{position:fixed;z-index:9999;background:#17151f;color:white;border-radius:6px;padding:5px 8px;font:11px/1.2 Arial;pointer-events:none;display:none}
@media(max-width:760px){.nav-links{display:none}.hero{grid-template-columns:1fr;min-height:720px;padding-top:55px}.hero:after{width:360px;height:360px;right:-140px;top:430px}.orb-label{display:none}.benefit-grid,.metrics{grid-template-columns:1fr}.section{padding-top:72px;padding-bottom:72px}.final{align-items:flex-start;flex-direction:column}h1{font-size:54px}.metric strong{font-size:54px}}
</style></head><body><div class="page">
<nav class="nav" data-design-id="navigation" data-design-label="Navigation"><a class="brand">${escapeHtml(brand.name)}</a><div class="nav-links"><a>Platform</a><a>Approach</a><a>Insights</a></div><a class="nav-cta">Talk to us</a></nav>
<main><section class="hero" data-design-id="hero" data-design-label="Hero section"><div class="hero-copy"><div class="eyebrow" data-design-id="hero-eyebrow" data-design-label="Hero eyebrow">${escapeHtml(landing.eyebrow)}</div><h1 data-design-id="hero-title" data-design-label="Hero title">${escapeHtml(landing.headline)}</h1><p class="subhead" data-design-id="hero-copy" data-design-label="Hero description">${escapeHtml(landing.subhead)}</p><div class="actions" data-design-id="hero-actions" data-design-label="Hero actions"><a class="button">${escapeHtml(landing.primaryCta)}</a><a class="link-button">${escapeHtml(landing.secondaryCta)} →</a></div></div><div class="orb-label">A clearer view of progress</div></section>
<section class="section" data-design-id="benefits" data-design-label="Benefits section"><div class="section-head"><div class="eyebrow">Designed for decisions</div><h2>Clarity at every step.</h2></div><div class="benefit-grid">${benefitCards}</div></section>
<section class="section proof" data-design-id="proof" data-design-label="Proof section"><div class="section-head"><div class="eyebrow">Measured progress</div><h2>Built to turn momentum into evidence.</h2></div><div class="metrics">${proofItems}</div></section>
<section class="section final" data-design-id="final-cta" data-design-label="Final call to action"><h2>${escapeHtml(landing.finalHeadline)}</h2><a class="button">${escapeHtml(landing.primaryCta)}</a></section></main>
<footer class="footer" data-design-id="footer" data-design-label="Footer"><strong>${escapeHtml(brand.name)}</strong><span>Climate intelligence, clarified.</span><span>© 2026</span></footer></div><div class="selection-tag"></div>
<script>
const tag=document.querySelector('.selection-tag');let selected;
document.addEventListener('mousemove',e=>{const el=e.target.closest('[data-design-id]');if(!el){tag.style.display='none';return}tag.textContent=el.dataset.designLabel||el.dataset.designId;tag.style.display='block';tag.style.left=(e.clientX+12)+'px';tag.style.top=(e.clientY+12)+'px'});
document.addEventListener('click',e=>{const el=e.target.closest('[data-design-id]');if(!el)return;e.preventDefault();selected?.removeAttribute('data-selected');selected=el;el.dataset.selected='true';parent.postMessage({type:'design-selection',selection:{deliverableId:'web',designId:el.dataset.designId,label:el.dataset.designLabel||el.dataset.designId,domPath:el.tagName.toLowerCase()+'[data-design-id="'+el.dataset.designId+'"]',text:(el.innerText||'').trim().slice(0,500),viewport:innerWidth<600?'mobile':'desktop'}},'*')});
</script></body></html>`;
}
