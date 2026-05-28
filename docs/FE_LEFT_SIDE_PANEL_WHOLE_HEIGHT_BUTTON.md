# Left Side Panel Height Modification Guide

This document provides comprehensive instructions on how to modify the height of the left sidebar panel in the explore page. The panel contains the dataset list and is styled with a glassmorphism effect.

## Overview

The left sidebar panel height is controlled by multiple CSS files and components working together. The height calculation involves:
- Header height (55px)
- Top spacing reduction
- Bottom spacing reduction
- Various container constraints

## Key Files Involved

### 1. Main Explore Page Styling
**File:** `resource-watch/css/components/app/pages/explore.scss`

This is the primary file controlling the sidebar panel height.

### 2. Dataset Container Styling
**File:** `resource-watch/layout/explore/explore-datasets/_styles.scss`

Controls the dataset list container height.

### 3. Dataset List Styling
**File:** `resource-watch/layout/explore/explore-datasets/list/_styles.scss`

Controls the actual dataset list height.

### 4. Sidebar Layout Styling
**File:** `resource-watch/css/layouts/_sidebar.scss`

Controls the overall sidebar layout.

## Height Calculation Formula

The panel height is calculated using this formula:
```scss
height: calc(100vh - [header_height] - [top_reduction] - [bottom_reduction])
```

Where:
- `header_height` = 55px (defined in `$header-main-height`)
- `top_reduction` = 15px (spacing from top)
- `bottom_reduction` = 15px (spacing from bottom)
- **Total reduction** = 85px

## Current Configuration

### Main Sidebar Content
```scss
.explore-sidebar-content {
  min-width: 340px;
  max-width: 340px;
  position: absolute;
  top: 15px; // Top spacing
  left: 13px;
  height: calc(100vh - 85px) !important; // 55px header + 15px top + 15px bottom
  z-index: 2;
  overflow: visible;
}
```

### Glass Panel Styling
```scss
.panel-style {
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  min-height: calc(100vh - 85px) !important; // Match sidebar content height
  max-height: calc(100vh - 85px) !important; // Match sidebar content height
  box-sizing: border-box;
  overflow-y: auto;
  padding-bottom: 20px;
  padding-top: 15px;
  padding-right: 15px;
}
```

### Dataset Container
```scss
.c-explore-datasets {
  position: relative;
  margin: 0px 4 * $space 0px 2 * $space;
  max-height: calc(100vh - 85px) !important; // Match glass panel height
  overflow-y: auto;
}
```

### Dataset List
```scss
.c-explore-dataset-list {
  position: relative;
  max-height: calc(100vh - 180px) !important; // Account for search, header, and pagination
  overflow-y: auto;
}
```

## How to Modify Panel Height

### 1. Change Bottom Reduction Only

To modify only the bottom spacing (e.g., to 20px):

**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
// Change from 85px to 90px (add 5px to bottom reduction)
.explore-sidebar-content {
  height: calc(100vh - 90px) !important; // 55px header + 15px top + 20px bottom
}

.panel-style {
  min-height: calc(100vh - 90px) !important;
  max-height: calc(100vh - 90px) !important;
}
```

**File:** `resource-watch/layout/explore/explore-datasets/_styles.scss`

```scss
.c-explore-datasets {
  max-height: calc(100vh - 90px) !important; // Match glass panel height
}
```

**File:** `resource-watch/layout/explore/explore-datasets/list/_styles.scss`

```scss
.c-explore-dataset-list {
  max-height: calc(100vh - 185px) !important; // Account for additional space
}
```

### 2. Change Top Reduction Only

To modify only the top spacing (e.g., to 25px):

**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
.explore-sidebar-content {
  top: 25px; // Change top position
  height: calc(100vh - 95px) !important; // 55px header + 25px top + 15px bottom
}

.panel-style {
  min-height: calc(100vh - 95px) !important;
  max-height: calc(100vh - 95px) !important;
}
```

**File:** `resource-watch/layout/explore/explore-datasets/_styles.scss`

```scss
.c-explore-datasets {
  max-height: calc(100vh - 95px) !important;
}
```

### 3. Change Both Top and Bottom

To modify both spacings (e.g., 20px top, 10px bottom):

**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
.explore-sidebar-content {
  top: 20px; // New top position
  height: calc(100vh - 85px) !important; // 55px header + 20px top + 10px bottom
}

.panel-style {
  min-height: calc(100vh - 85px) !important;
  max-height: calc(100vh - 85px) !important;
}
```

### 4. Remove All Reductions (Full Height)

To make the panel extend to full viewport height:

**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
.explore-sidebar-content {
  top: 0; // No top spacing
  height: calc(100vh - 55px) !important; // Only header height
}

.panel-style {
  min-height: calc(100vh - 55px) !important;
  max-height: calc(100vh - 55px) !important;
}
```

**File:** `resource-watch/layout/explore/explore-datasets/_styles.scss`

```scss
.c-explore-datasets {
  max-height: calc(100vh - 55px) !important;
}
```

## Important Constants

### Header Height
**File:** `resource-watch/css/_settings.scss`

```scss
$header-main-height: 55px;
$header-main-height-mobile: 50px;
```

### Space Variables
**File:** `resource-watch/css/_settings.scss`

```scss
$space: 8px; // Base spacing unit
```

## Synchronization Requirements

When modifying panel height, ensure all related components are updated:

1. **`.explore-sidebar-content`** - Main container
2. **`.panel-style`** - Glass panel background
3. **`.c-explore-datasets`** - Dataset container
4. **`.c-explore-dataset-list`** - Dataset list (with additional space for search/pagination)

## Common Height Configurations

### Minimal Spacing (5px top, 5px bottom)
```scss
height: calc(100vh - 65px) !important; // 55px header + 5px top + 5px bottom
```

### Balanced Spacing (15px top, 15px bottom) - Current
```scss
height: calc(100vh - 85px) !important; // 55px header + 15px top + 15px bottom
```

### Generous Spacing (25px top, 25px bottom)
```scss
height: calc(100vh - 105px) !important; // 55px header + 25px top + 25px bottom
```

### Asymmetric Spacing (10px top, 30px bottom)
```scss
height: calc(100vh - 95px) !important; // 55px header + 10px top + 30px bottom
```

## Troubleshooting

### Issue: Panel Not Updating
**Solution:** Ensure all height values are synchronized across all files and use `!important` to override other styles.

### Issue: Gap at Bottom
**Solution:** Check that the header height calculation is correct (55px, not 100px).

### Issue: Scrollbar Misalignment
**Solution:** Adjust the scrollbar track margins to match the panel boundaries.

### Issue: Content Overflow
**Solution:** Ensure the dataset list height accounts for search bar, header, and pagination space.

## Testing Changes

After modifying heights:

1. **Hard refresh** the browser (Ctrl+F5 or Cmd+Shift+R)
2. **Check responsiveness** on different screen sizes
3. **Verify scrolling** works correctly
4. **Test navigation** between different pages
5. **Validate** that all content is visible

## Best Practices

1. **Always use `!important`** for height modifications to ensure they override other styles
2. **Keep all height values synchronized** across related components
3. **Test on multiple screen sizes** to ensure responsiveness
4. **Document changes** in comments for future reference
5. **Use consistent spacing** (multiples of 5px or 10px) for better visual harmony

## Related Documentation

- `LEFT_SIDEBAR_PANEL_CONFIGURATION.md` - Overall sidebar configuration
- `MAIN_HEADER_MENU_CONFIGURATION.md` - Header height and menu configuration
- `FRONTEND_EXPLORE_PAGE_DOCUMENTATION.md` - Explore page structure

## Scrollbar Positioning and Padding Control

### Understanding Scrollbar Behavior

The scrollbar positioning in the left sidebar panel is controlled by a combination of padding and container width settings. Understanding this relationship is crucial for proper scrollbar placement.

### Key Components for Scrollbar Control

#### 1. Glass Panel Container
**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
.panel-style {
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  min-height: calc(100vh - 85px) !important;
  max-height: calc(100vh - 85px) !important;
  box-sizing: border-box;
  overflow-y: auto; // Enables scrolling
  padding-bottom: 20px;
  padding-top: 15px;
  padding-right: 0px; // Controls scrollbar position
}
```

**Key Properties:**
- `padding-right: 0px` - **Controls scrollbar distance from content**
- `overflow-y: auto` - **Enables vertical scrolling**
- `box-sizing: border-box` - **Includes padding in width calculations**

#### 2. Dataset List Wrapper
**File:** `resource-watch/layout/explore/explore-datasets/list/_styles.scss`

```scss
.dataset-list-wrapper {
  position: relative;
  width: 100%;
  height: calc(100vh - 190px);
  overflow: hidden; // Hides wrapper's scrollbar
  padding-right: 0px; // Controls scrollbar position
}

.c-explore-dataset-list {
  position: relative;
  max-height: calc(100vh - 190px) !important;
  overflow-y: auto; // Enables scrolling for the list
  padding-right: 0px; // Remove any padding
  margin-right: 0px; // Remove any margin
  width: 100%; // Normal width
}
```

**Key Properties:**
- `padding-right: 0px` - **Controls scrollbar distance from content**
- `overflow: hidden` on wrapper - **Prevents double scrollbars**
- `overflow-y: auto` on list - **Enables scrolling**

### How Padding Controls Scrollbar Position

#### The Relationship:
```
Container Width = Content Width + Padding + Scrollbar Width
```

#### Examples:

**1. Scrollbar at Edge (Current Configuration):**
```scss
.panel-style {
  padding-right: 0px; // No padding = scrollbar at edge
}
```
- **Result:** Scrollbar appears at the right edge of the container
- **Content:** Uses full available width
- **Visual:** No gap between content and scrollbar

**2. Scrollbar with 20px Gap:**
```scss
.panel-style {
  padding-right: 20px; // 20px padding = 20px gap
}
```
- **Result:** Scrollbar appears 20px from the content
- **Content:** Uses width minus 20px
- **Visual:** 20px gap between content and scrollbar

**3. Scrollbar with 40px Gap:**
```scss
.panel-style {
  padding-right: 40px; // 40px padding = 40px gap
}
```
- **Result:** Scrollbar appears 40px from the content
- **Content:** Uses width minus 40px
- **Visual:** 40px gap between content and scrollbar

### Scrollbar Positioning Techniques

#### Method 1: Padding Control (Recommended)
**Pros:** Simple, reliable, cross-browser compatible
**Cons:** Reduces content width

```scss
// Push scrollbar 20px to the right
.panel-style {
  padding-right: 20px;
}

// Push scrollbar to edge
.panel-style {
  padding-right: 0px;
}

// Push scrollbar further right (negative padding)
.panel-style {
  padding-right: -10px; // Scrollbar extends beyond container
}
```

#### Method 2: Container Width Manipulation
**Pros:** Doesn't affect content width
**Cons:** More complex, can cause layout issues

```scss
.dataset-list-wrapper {
  padding-right: 20px; // Create space
}

.c-explore-dataset-list {
  width: calc(100% + 20px); // Make container wider
  margin-right: -20px; // Pull content back
}
```

#### Method 3: Webkit Scrollbar Margins (Limited Support)
**Pros:** Direct scrollbar control
**Cons:** Limited browser support, unreliable

```scss
.c-explore-dataset-list {
  &::-webkit-scrollbar {
    margin-right: 20px; // Limited browser support
  }
}
```

### Current Scrollbar Configuration

#### Files and Settings:

**1. Glass Panel (`explore.scss`):**
```scss
.panel-style {
  padding-right: 0px; // Scrollbar at edge
}
```

**2. Dataset Wrapper (`list/_styles.scss`):**
```scss
.dataset-list-wrapper {
  padding-right: 0px; // No additional padding
}
```

**3. Dataset List (`list/_styles.scss`):**
```scss
.c-explore-dataset-list {
  padding-right: 0px; // No padding
  margin-right: 0px; // No margin
  width: 100%; // Full width
}
```

### How to Modify Scrollbar Position

#### Push Scrollbar 20px to the Right:
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-style {
  padding-right: 20px; // Add 20px gap
}

// File: resource-watch/layout/explore/explore-datasets/list/_styles.scss
.dataset-list-wrapper {
  padding-right: 20px; // Add 20px gap
}
```

#### Push Scrollbar to Absolute Edge:
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-style {
  padding-right: 0px; // No gap
}

// File: resource-watch/layout/explore/explore-datasets/list/_styles.scss
.dataset-list-wrapper {
  padding-right: 0px; // No gap
}
```

#### Push Scrollbar Beyond Container (Negative Padding):
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-style {
  padding-right: -10px; // Scrollbar extends beyond container
}
```

### Scrollbar Styling

#### Custom Scrollbar Appearance:
```scss
.panel-style {
  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 12px; // Scrollbar width
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    margin-top: 15px; // Align with panel boundaries
    margin-bottom: 15px; // Align with panel boundaries
  }
  
  &::-webkit-scrollbar-thumb {
    background: #4effd0; // Turquoise color
    border-radius: 4px;
    
    &:hover {
      background: #4effd0; // Keep turquoise on hover
    }
  }
  
  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: #4effd0 rgba(255, 255, 255, 0.1);
}
```

### Troubleshooting Scrollbar Issues

#### Issue: Scrollbar Not Moving
**Cause:** Conflicting padding values
**Solution:** Ensure consistent padding across all containers

#### Issue: Double Scrollbars
**Cause:** Multiple containers with `overflow-y: auto`
**Solution:** Use `overflow: hidden` on wrapper containers

#### Issue: Scrollbar Disappears
**Cause:** `overflow: hidden` on scrolling container
**Solution:** Use `overflow-y: auto` on the scrolling element

#### Issue: Content Overlaps Scrollbar
**Cause:** Insufficient padding
**Solution:** Increase `padding-right` value

### Best Practices for Scrollbar Control

1. **Use padding-right for positioning** - Most reliable method
2. **Keep values synchronized** - All containers should have consistent padding
3. **Test across browsers** - Webkit properties may not work in all browsers
4. **Consider content width** - More padding = less content space
5. **Use negative values sparingly** - Can cause layout issues

### Quick Reference for Scrollbar Positioning

| Desired Effect | padding-right Value | Result |
|----------------|-------------------|---------|
| Scrollbar at edge | `0px` | No gap between content and scrollbar |
| 10px gap | `10px` | 10px space between content and scrollbar |
| 20px gap | `20px` | 20px space between content and scrollbar |
| 30px gap | `30px` | 30px space between content and scrollbar |
| Scrollbar beyond container | `-10px` | Scrollbar extends beyond container edge |

## Quick Reference

| Component | File | Current Height | Purpose |
|-----------|------|----------------|---------|
| Sidebar Content | `explore.scss` | `calc(100vh - 85px)` | Main container |
| Glass Panel | `explore.scss` | `calc(100vh - 85px)` | Background styling |
| Dataset Container | `explore-datasets/_styles.scss` | `calc(100vh - 85px)` | Dataset wrapper |
| Dataset List | `list/_styles.scss` | `calc(100vh - 180px)` | Actual list content |

## Scrollbar Control Reference

| Component | File | Current padding-right | Scrollbar Position |
|-----------|------|---------------------|-------------------|
| Glass Panel | `explore.scss` | `0px` | At edge |
| Dataset Wrapper | `list/_styles.scss` | `0px` | At edge |
| Dataset List | `list/_styles.scss` | `0px` | At edge |

---

*Last updated: [Current Date]*
*Version: 3.0 - Added comprehensive X button and arrow button configuration guide*

## X Button and Arrow Button Configuration

This section provides complete documentation for the X button (close) and arrow button (open) functionality in the left sidebar panel.

### Overview

The left sidebar panel uses two different buttons for opening and closing:
- **Arrow Button**: Opens the glass panel (only visible when sidebar is closed)
- **X Button**: Closes the glass panel (only visible when sidebar is open)

### Arrow Button Configuration

#### File Location
**File:** `resource-watch/layout/explore/explore-sidebar/component.js`

#### Arrow Button Implementation
```jsx
{!open && (
  <button type="button" className="btn-toggle" onClick={this.triggerToggle}>
    <Icon
      className={classnames({
        '-little': true,
        '-right': true, // Always points right for opening
      })}
      name="icon-arrow-down"
    />
  </button>
)}
```

#### Arrow Button Styling
**File:** `resource-watch/css/layouts/_sidebar.scss`

```scss
// Toggle button
.btn-toggle {
  display: none;
  justify-content: center;
  align-items: center;
  position: absolute;
  width: 30px;
  height: 40px;
  top: 20px;
  left: calc(100% + 0px); // Positioned at sidebar edge
  z-index: 10; // Higher z-index to ensure it's clickable
  cursor: pointer;
  background: #44546a; // Arrow container background color
  border: none;
  border-radius: 0 2px 2px 0;
  transition: background $animation-time-2 $ease-in-out-sine;

  @media screen and (min-width: map-get($breakpoints, medium)) {
    display: flex;
  }

  .c-icon {
    width: 12px;
    fill: #4effd0; // Turquoise arrow color

    &.-left { transform: rotate(90deg); }
    &.-right { transform: rotate(-90deg); }
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.1); // Subtle hover with white
  }
}
```

#### Arrow Button Properties
- **Position**: `left: calc(100% + 0px)` - Right at the sidebar edge
- **Size**: 30px width × 40px height
- **Background**: `#44546a` (dark blue-gray)
- **Arrow Color**: `#4effd0` (turquoise)
- **Arrow Direction**: Always points right (for opening)
- **Visibility**: Only shows when sidebar is closed (`!open` condition)
- **Z-index**: 10 (ensures clickability)

### X Button Configuration

#### File Location
**File:** `resource-watch/layout/explore/component.jsx`

#### X Button Implementation
```jsx
{!subsection && !selected && open && (
  <div className="explore-sidebar-content panel-style" id="sidebar-content-container" key={section}>
    <button 
      type="button" 
      className="panel-close-btn" 
      onClick={() => setSidebarOpen(false)}
      title="Close panel"
    >
      <Icon name="icon-cross" />
    </button>
    {/* Panel content */}
  </div>
)}
```

#### X Button Styling
**File:** `resource-watch/css/components/app/pages/explore.scss`

```scss
// Close button for glass panel
.panel-close-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 16px;
  color: #ffffff;
  z-index: 10;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
    transform: scale(1.1);
  }

  .c-icon {
    width: 10px;
    height: 10px;
    fill: rgba(255, 255, 255, 0.7);
    font-weight: 300;
  }
}
```

#### X Button Properties
- **Position**: `top: 2px; right: 2px` - Very close to top-right corner
- **Size**: 32px × 32px button with 10px × 10px X icon
- **Background**: `rgba(255, 255, 255, 0.1)` (semi-transparent white)
- **Border**: `1px solid rgba(255, 255, 255, 0.2)` (subtle white border)
- **X Color**: `rgba(255, 255, 255, 0.7)` (70% opacity white)
- **Border Radius**: 8px (rounded corners)
- **Visibility**: Only shows when sidebar is open (`open` condition)
- **Z-index**: 10 (ensures clickability)

### Button Behavior and States

#### When Sidebar is Closed
- **Arrow Button**: ✅ Visible at sidebar edge
- **X Button**: ❌ Hidden (not rendered)
- **Arrow Direction**: Points right (indicating "click to open")
- **Functionality**: Clicking opens the glass panel

#### When Sidebar is Open
- **Arrow Button**: ❌ Hidden (not rendered)
- **X Button**: ✅ Visible in top-right corner of glass panel
- **X Appearance**: Subtle white X with semi-transparent background
- **Functionality**: Clicking closes the glass panel

### How to Modify Button Positions

#### Move Arrow Button Left by 10px
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle {
  left: calc(100% - 10px); // Move 10px to the left
}
```

#### Move Arrow Button Right by 10px
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle {
  left: calc(100% + 10px); // Move 10px to the right
}
```

#### Move X Button Closer to Corner
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn {
  top: 1px;
  right: 1px; // Move closer to corner
}
```

#### Move X Button Away from Corner
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn {
  top: 10px;
  right: 10px; // Move away from corner
}
```

### How to Modify Button Colors

#### Change Arrow Button Background
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle {
  background: #your-color; // Change background color
}
```

#### Change Arrow Color
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle .c-icon {
  fill: #your-color; // Change arrow color
}
```

#### Change X Button Background
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn {
  background: rgba(your-r, your-g, your-b, your-alpha); // Change background
}
```

#### Change X Color
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn .c-icon {
  fill: rgba(255, 255, 255, your-opacity); // Change X color and opacity
}
```

### How to Modify Button Sizes

#### Make Arrow Button Larger
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle {
  width: 40px; // Increase width
  height: 50px; // Increase height
  
  .c-icon {
    width: 16px; // Increase arrow size
  }
}
```

#### Make X Button Larger
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn {
  width: 40px; // Increase button size
  height: 40px;
  
  .c-icon {
    width: 14px; // Increase X size
    height: 14px;
  }
}
```

### Button Hover Effects

#### Arrow Button Hover
```scss
// File: resource-watch/css/layouts/_sidebar.scss
.btn-toggle:hover {
  background-color: rgba(255, 255, 255, 0.1); // Subtle white hover
  transform: scale(1.05); // Optional scale effect
}
```

#### X Button Hover
```scss
// File: resource-watch/css/components/app/pages/explore.scss
.panel-close-btn:hover {
  background: rgba(255, 255, 255, 0.2); // Brighter background
  border-color: rgba(255, 255, 255, 0.4); // More visible border
  transform: scale(1.1); // Scale effect
}
```

### Button Icon Customization

#### Change Arrow Icon
```jsx
// File: resource-watch/layout/explore/explore-sidebar/component.js
<Icon
  className={classnames({
    '-little': true,
    '-right': true,
  })}
  name="your-icon-name" // Change icon name
/>
```

#### Change X Icon
```jsx
// File: resource-watch/layout/explore/component.jsx
<Icon name="your-icon-name" /> // Change icon name
```

### Common Button Modifications

#### Make X Button More Subtle
```scss
.panel-close-btn {
  background: rgba(255, 255, 255, 0.05); // More transparent
  border: 1px solid rgba(255, 255, 255, 0.1); // Subtler border
  
  .c-icon {
    fill: rgba(255, 255, 255, 0.5); // More subtle X
  }
}
```

#### Make X Button More Prominent
```scss
.panel-close-btn {
  background: rgba(255, 255, 255, 0.2); // More opaque
  border: 1px solid rgba(255, 255, 255, 0.4); // More visible border
  
  .c-icon {
    fill: rgba(255, 255, 255, 1); // Full opacity X
  }
}
```

#### Make Arrow Button More Visible
```scss
.btn-toggle {
  background: #your-color; // Solid background
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); // Add shadow
  
  .c-icon {
    fill: #your-color; // Custom arrow color
  }
}
```

### Troubleshooting Button Issues

#### Issue: Arrow Button Not Visible
**Cause:** CSS media query or z-index issue
**Solution:** Check `@media screen and (min-width: map-get($breakpoints, medium))` and z-index

#### Issue: X Button Not Clickable
**Cause:** Z-index too low or positioned incorrectly
**Solution:** Increase z-index or check positioning

#### Issue: Buttons Overlap
**Cause:** Incorrect positioning or sizing
**Solution:** Adjust `left`, `top`, `right` values and button sizes

#### Issue: Hover Effects Not Working
**Cause:** CSS specificity or transition issues
**Solution:** Use `!important` or check transition properties

### Button State Management

#### JavaScript State Control
```jsx
// File: resource-watch/layout/explore/explore-sidebar/component.js
triggerToggle = () => {
  const { open } = this.props;
  this.props.setSidebarOpen(!open); // Toggle sidebar state
};
```

#### Redux Integration
```jsx
// File: resource-watch/layout/explore/component.jsx
const { open, setSidebarOpen } = this.props; // Get state from Redux

// Close button functionality
onClick={() => setSidebarOpen(false)} // Close sidebar
```

### Quick Reference for Button Configuration

| Button | File | Current Position | Current Size | Current Color |
|--------|------|------------------|--------------|---------------|
| Arrow | `_sidebar.scss` | `calc(100% + 0px)` | 30×40px | `#44546a` bg, `#4effd0` arrow |
| X | `explore.scss` | `top: 2px, right: 2px` | 32×32px | `rgba(255,255,255,0.1)` bg, `rgba(255,255,255,0.7)` X |

### Best Practices for Button Configuration

1. **Use consistent z-index values** - Ensure buttons are always clickable
2. **Test hover effects** - Verify visual feedback works correctly
3. **Maintain accessibility** - Include proper `title` attributes
4. **Use semantic positioning** - Position buttons logically relative to content
5. **Keep colors consistent** - Match overall application color scheme
6. **Test on different screen sizes** - Ensure buttons work on mobile and desktop
7. **Use smooth transitions** - Provide visual feedback for interactions

---
