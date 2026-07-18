import { describe, expect, it } from "vitest";
import { defaultProject } from "@/domain/defaults";
import { renderLandingHtml, tokensToCss } from "@/server/landing";

describe("landing renderer", () => {
  it("renders shared tokens and selectable design identifiers", () => {
    const css = tokensToCss(defaultProject);
    const html = renderLandingHtml(defaultProject);
    expect(css).toContain("--brand-primary: #1C3D38");
    expect(html).toContain('data-design-id="hero-title"');
    expect(html).toContain("design-selection");
    expect(html).toContain(defaultProject.landing.headline);
    expect(html.match(/class="benefit"/g)).toHaveLength(3);
  });

  it("escapes project-authored content", () => {
    const project = structuredClone(defaultProject);
    project.landing.headline = '<script>alert("x")</script>';
    const html = renderLandingHtml(project);
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("renders accessible inline navigation icons when enabled", () => {
    const project = structuredClone(defaultProject);
    project.landing.navigation.showIcons = true;
    const html = renderLandingHtml(project);
    expect(html.match(/class="nav-icon"/g)).toHaveLength(3);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain("<span>Platform</span>");
  });
});
