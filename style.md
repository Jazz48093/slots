# CLEAN, MINIMAL & GLASSMORPHIC UI STYLE RULEBOOK

## 1. Purpose & Design Ethos

This rulebook defines the visual language for the interface. Every page, section, component, card, button, input, and interactive state adheres strictly to these principles.

The target visual identity is:
* **Clean & Minimalist**: Uncluttered whitespace, purposeful contrast, and refined typography.
* **Glassmorphic & Translucent**: Frosted glass surfaces with subtle multi-stop backdrop blurring, luminous hairline borders, and specular inner highlights.
* **Modern & Sophisticated**: Soft ambient lighting, nuanced slate color gradients, and effortless hierarchy.
* **Tactile & Responsive**: Natural physics, fluid micro-interactions, and smooth elevation on hover.

The design feels like an elite modern operating system interface (e.g. macOS Sonoma / iOS / VisionOS) translated into an executive data analytics dashboard.

---

# 2. THE FIVE CORE RULES

### Rule 1: Surface Translucency & Blur
Every structural container (header, cards, sidebars, modals) sits as an elevated frosted glass sheet over an ambient gradient background.
* Use `backdrop-filter: blur(20px) saturate(180%);`
* Use translucent background fills: `rgba(255, 255, 255, 0.72)` to `rgba(255, 255, 255, 0.85)`
* Support graceful degradation with solid fallback colors.

### Rule 2: Luminous Hairline Borders
Never use thick black or muddy borders. Define physical glass edges with crisp, semi-transparent hairline borders:
* `border: 1px solid rgba(255, 255, 255, 0.8);`
* Layer with subtle inner highlights: `box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.9), 0 10px 30px -5px rgba(0, 0, 0, 0.05);`

### Rule 3: Soft Ambient Shadows (No Hard Edges)
Shadows must be deep, soft, and diffuse, mimicking natural light filtering through frosted glass:
* 0 hard offset shadows.
* Multi-layered shadows with large blur radius and low opacity (e.g. `rgba(15, 23, 42, 0.06)`).

### Rule 4: Refined Squircle Geometry
Replace harsh 0px corners with organic, ergonomic squircle radii:
* Main Containers & Cards: `16px` to `20px`
* Inner Elements, Buttons & Inputs: `10px` to `12px`
* Badges, Chips & Avatars: `9999px` (Pills)

### Rule 5: Elegant Typography Hierarchy
Typography is effortless, balanced, and readable:
* Primary Typeface: **Outfit** / **Inter** / **Plus Jakarta Sans**
* Crisp contrast: Deep Slate `#0F172A` for headers, Muted Slate `#64748B` for secondary labels.
* Sentence case for headlines and body; subtle uppercase tracking (`letter-spacing: 0.06em`) for small metadata pills.

---

# 3. COLOR PALETTE & TOKENS

## 3.1 Approved Palette

| Token | Value | Purpose |
| :--- | :--- | :--- |
| **Canvas Background** | `#F8FAFC` to `#F1F5F9` | Ambient soft backdrop with luminous pastel radial orbs |
| **Glass Surface (Default)** | `rgba(255, 255, 255, 0.75)` | Cards, sidebar, header surfaces |
| **Glass Surface (Hover)** | `rgba(255, 255, 255, 0.90)` | Interactive cards on hover |
| **Glass Surface (Elevated)** | `rgba(255, 255, 255, 0.95)` | Modals, floating action banners |
| **Glass Border** | `rgba(255, 255, 255, 0.85)` | Upper specular light edge |
| **Glass Border Subtitle** | `rgba(226, 232, 240, 0.80)` | Lower boundary edge |
| **Text Primary** | `#0F172A` | Headlines, primary values, high-contrast text |
| **Text Secondary** | `#475569` | Subtitles, labels, metadata |
| **Text Muted** | `#94A3B8` | Hints, counts, timestamps |
| **Primary Accent (Indigo)** | `#4F46E5` | Active buttons, primary highlights, date filters |
| **Primary Accent Light** | `#EEF2FF` | Active background tints, selection fills |
| **Secondary Accent (Azure)** | `#0284C7` | Product chips, links, secondary actions |
| **Success / Status (Emerald)**| `#10B981` | Positive counts, live sync status badge |
| **Warning / Attention (Amber)**| `#F59E0B` | Badges, high-priority notifications |
| **Danger / Reset (Rose)** | `#EF4444` | Clear all, delete actions |

---

# 4. GLASSMORPHISM SPECIFICATION

```css
/* Standard Glass Surface */
.glass-panel {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid rgba(226, 232, 240, 0.7);
  box-shadow: 
    0 10px 30px -5px rgba(15, 23, 42, 0.05),
    0 4px 12px -2px rgba(15, 23, 42, 0.02),
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.95);
  border-radius: 16px;
}

/* Elevated Glass Surface (Hover / Popups) */
.glass-panel-elevated {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(24px) saturate(190%);
  -webkit-backdrop-filter: blur(24px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.95);
  box-shadow: 
    0 20px 40px -10px rgba(15, 23, 42, 0.08),
    0 8px 16px -4px rgba(15, 23, 42, 0.04),
    inset 0 1px 1px 0 rgba(255, 255, 255, 1);
}
```

---

# 5. TYPOGRAPHY RULES

* **Typeface**: `Outfit`, `Inter`, or `Plus Jakarta Sans`, sans-serif.
* **Scale & Weight**:
  * **Hero Title**: `1.4rem` to `1.6rem`, Weight `800`, tracking `-0.03em`.
  * **Section Headings**: `1.1rem` to `1.25rem`, Weight `700`, tracking `-0.02em`.
  * **Metric Values**: `2.2rem` to `2.6rem`, Weight `800`, tracking `-0.04em`.
  * **Card Titles**: `0.92rem`, Weight `600`, line-height `1.35`.
  * **Labels & Badges**: `0.72rem` to `0.78rem`, Weight `700`, uppercase tracking `0.06em`.
  * **Body & Hints**: `0.8rem` to `0.85rem`, Weight `500`, muted slate.

---

# 6. BUTTONS & CONTROLS

* **Structure**: Clean rounded rect (`border-radius: 10px`), subtle border, glass gradient or solid vibrant accent.
* **Primary Glass Button**:
  ```css
  background: linear-gradient(135deg, #4F46E5 0%, #3B82F6 100%);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 14px 0 rgba(79, 70, 229, 0.35);
  border-radius: 10px;
  padding: 8px 16px;
  font-weight: 600;
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
  ```
* **Secondary Glass Button**:
  ```css
  background: rgba(255, 255, 255, 0.85);
  color: #0F172A;
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  padding: 8px 16px;
  font-weight: 600;
  ```
* **Hover Interaction**:
  * `transform: translateY(-2px);`
  * Increased shadow glow.
* **Active State**:
  * `transform: translateY(0px) scale(0.98);`

---

# 7. PRODUCT SHOWCASE & EXPANDED CARDS

* **Compact Cards**:
  * Pristine white glass surface with `16px` border-radius.
  * Image container with soft gradient background and `12px` radius.
  * Full crisp color images with high-resolution clarity.
  * Orders badge and Target status indicator (`🎯 X / Y Target` or `✓ Goal Met`).
  * Minimal rounded target progress bar (`border-radius: 9999px`) with emerald gradient when met, indigo gradient in progress.
  * Subtle hover lift: `transform: translateY(-4px); box-shadow: 0 16px 32px -8px rgba(15, 23, 42, 0.1);`.
* **Expanded View**:
  * Smooth accordion in-place expansion with `animation: glassExpand 250ms cubic-bezier(0.16, 1, 0.3, 1);`.
  * **Interactive Header as Close Trigger**: The entire top header row acts as an intuitive close button on click, featuring a frosted glass hover highlight, animated collapse chevron pill affordance (`.header-collapse-affordance`), and `event.stopPropagation()` on external links.
  * 4 Clean KPI pill metrics (`Total Orders`, `Active Mediators`, `Top Direct Code`, `Active Dates`).
  * 3 Bifurcation panels with rounded progress bars (`border-radius: 9999px`) and vibrant gradient fills (Active Mediators, Direct Codes Slot Performance, Orders by Date).

---

# 8. TABLES & DATA LISTS

* Header with light slate background `rgba(241, 245, 249, 0.8)` and uppercase label typography.
* Cells with generous vertical breathing room (`10px 14px`).
* Status chips with subtle background tints and saturated text colors.
* Zero cramped scroll containers — full length records shown cleanly with smooth document scroll.

---

# 9. WHAT NOT TO USE (EXCLUSIONS)

* ❌ **NO brutalist thick black 4px borders**.
* ❌ **NO zero-blur hard offset shadows (`4px 4px 0 #000`)**.
* ❌ **NO harsh 0px square corners on cards or buttons**.
* ❌ **NO abrasive raw primary color blocks without transparency**.
* ❌ **NO forced 100% grayscale images on product cards**.
* ❌ **NO cluttered, heavy layouts**.

