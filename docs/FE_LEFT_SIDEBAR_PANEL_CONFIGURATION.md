# Left Sidebar Panel Configuration Documentation

## Overview
This document provides comprehensive documentation for the left sidebar panel configuration in the Resource Watch application. It covers all styling, functionality, file structure, and integration details for the sidebar components.

## Table of Contents
1. [Panel Structure](#panel-structure)
2. [Color Scheme](#color-scheme)
3. [File Structure](#file-structure)
4. [Component Integration](#component-integration)
5. [Styling Details](#styling-details)
6. [Functionality](#functionality)
7. [Code Snippets](#code-snippets)
8. [Modification Guide](#modification-guide)

## Panel Structure

The left sidebar consists of three main panels:

### 1. Main Sidebar Container (`c-sidebar`)
- **Purpose**: Parent container for all sidebar content
- **Background**: `rgba(30, 30, 30, 0.85)` with `blur(8px)` backdrop filter
- **Height**: `calc(100% - 320px)`
- **Position**: Sticky positioning

### 2. Menu Panel (`c-explore-menu`)
- **Purpose**: Contains navigation options (ALL DATA, TOPICS, MY DATA, MY FAVORITES)
- **Background**: `rgba(30, 30, 30, 0.85)` with `blur(8px)` backdrop filter
- **Height**: `calc(100% - 1320px)`
- **Width**: `180px`

### 3. Content Panel (`explore-sidebar-content`)
- **Purpose**: Contains the dataset list and sorting options
- **Background**: `rgba(30, 30, 30, 0.85)` with `blur(8px)` backdrop filter
- **Height**: `calc(100vh - 100px)`
- **Position**: Absolute positioning at `left: 180px`

## Color Scheme

### Primary Colors
- **Dark Background**: `rgba(30, 30, 30, 0.85)` - Semi-transparent dark background
- **Blur Effect**: `blur(8px)` - Glassmorphism effect
- **Text Color**: `#FFFFFF` - Pure white for main text
- **Accent Color**: `#4effd0` - Turquoise for hover effects and accents
- **Small Titles**: `#4effd0` - Turquoise for source and date information

### Interactive States
- **Hover Color**: `#4effd0` - Turquoise when hovering over menu options
- **Active State**: `rgba(255, 255, 255, 0.1)` - Subtle white background for active items
- **Border Color**: `rgba(255, 255, 255, 0.2)` - Light white borders

## File Structure

```
resource-watch/
├── layout/
│   └── explore/
│       ├── explore-menu/
│       │   ├── component.jsx          # Main menu component
│       │   └── _styles.scss           # Menu styling
│       ├── explore-datasets/
│       │   ├── component.jsx          # Dataset list component
│       │   ├── _styles.scss           # Dataset list styling
│       │   ├── explore-datasets-actions/
│       │   │   ├── component.jsx      # Action buttons component
│       │   │   └── _styles.scss       # Action buttons styling
│       │   └── list/
│       │       └── list-item/
│       │           ├── component.js    # Individual dataset item
│       │           └── _styles.scss   # Dataset item styling
│       └── explore-map/
│           └── _styles.scss           # Map styling
├── css/
│   └── layouts/
│       └── _sidebar.scss              # Main sidebar styling
└── components/
    └── datasets/
        └── search/
            └── search.scss            # Search dropdown styling
```

## Component Integration

### Menu Component Integration
The menu component (`explore-menu/component.jsx`) integrates with:
- **DatasetSearch**: Search functionality for filtering datasets
- **ExploreMenu**: Navigation options (ALL DATA, TOPICS, MY DATA, MY FAVORITES)
- **Collections**: User-specific collections and favorites

### Dataset List Integration
The dataset list integrates with:
- **ExploreDatasetsActions**: Add to map and star buttons
- **DatasetListItem**: Individual dataset cards
- **Search Component**: Filter and search functionality

## Styling Details

### Main Sidebar Styling (`css/layouts/_sidebar.scss`)

```scss
.c-sidebar {
  width: 100%;
  display: flex;
  flex-direction: column;
  max-width: $max-width-sidebar;
  height: calc(100% - 320px); // Increased height to allow menu panel to extend
  background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background with blur effect
  backdrop-filter: blur(8px); // Glassmorphism effect
  color: #FFFFFF; // Updated text color to match header
  z-index: 3;

  .sidebar-content {
    position: relative;
    overflow-x: hidden;
    overflow-y: visible; // Allow content to extend beyond container
    width: 100%;
    height: 100%;
  }

  .btn-toggle {
    background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background with blur effect
    backdrop-filter: blur(8px); // Glassmorphism effect
  }
}
```

### Menu Panel Styling (`layout/explore/explore-menu/_styles.scss`)

```scss
.c-explore-menu {
  min-width: 180px; // Reduced from 200px
  max-width: 180px; // Reduced from 200px
  height: calc(100% - 1320px); // Increased height by additional 500px
  position: sticky;
  top: 0;
  left: 0;
  background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background with blur effect
  backdrop-filter: blur(8px); // Glassmorphism effect

  .c-dataset-search {
    position: absolute;
    z-index: 999;
    background-color: transparent;
    backdrop-filter: blur(10px);
    width: 100%;
    height: calc(100% - 500px); // Reduced height by 500px from bottom
    padding: (2 * $space) 0 (2 * $space) (2 * $space);
  }

  .menu-options {
    margin-top: (14 * $space);

    > .menu-option {
      position: relative;
      display: flex;
      align-items: center;
      height: 45px;
      cursor: pointer;
      font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
      font-weight: 200; // Medium weight to match header
      text-transform: uppercase; // Uppercase to match header
      letter-spacing: 0.1em; // Exact letter spacing to match header
      color: #FFFFFF; // Updated color to match header text

      .section-name,
      .collection-name {
        margin-left: (5 * $space);
        font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        font-weight: 500; // Medium weight to match header
        font-size: 14px; // Increased font size by 2px (12px + 2px)
        text-transform: uppercase; // Uppercase to match header
        letter-spacing: 0.1em; // Exact letter spacing to match header
        color: #FFFFFF; // Updated color to match header text
      }

      &:hover {
        background-color: rgba(255, 255, 255, 0.1); // Subtle hover with white
        
        .section-name,
        .collection-name {
          color: #4effd0; // Change text color to turquoise on hover
        }
      }
    }
  }
}
```

### Dataset List Styling (`layout/explore/explore-datasets/list/list-item/_styles.scss`)

```scss
.c-explore-dataset-list-item {
  display: flex;
  flex-direction: row;
  position: relative;
  min-height: 130px;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 1px 6px 0 rgba(0,0,0,.0);
  box-sizing: border-box;
  transition: all $animation-time-2 $ease-in-out-sine;
  background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background

  .info {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 170px;
    padding: 2 * $space 3 * $space 3 * $space 2 * $space;
    background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background
    border-radius: 0 4px 4px 0; // Match the card's border radius on the right side
    color: #FFFFFF; // Default white text for all content

    // Make all text elements white
    h1, h2, h3, h4, h5, h6, p, span, div, a {
      color: #FFFFFF !important; // Force white text for all elements
      font-size: calc(1em - 0.5px); // Increase font size by 1.5px (was -2px, now -0.5px)
    }

    .source-date {
      display: flex;
      width: 100%;
      justify-content: space-between;
      margin-bottom: 5px;
      font-size: calc(#{$font-size-tiny} - 0.5px); // Increase font size by 1.5px (was -2px, now -0.5px)
      font-weight: bold;
      line-height: 10px;
      color: #4effd0 !important; // Turquoise color for smaller titles

      .source {
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
          margin-right: 4 * $space;
          max-width: 100px;
          color: #4effd0 !important; // Turquoise color for smaller titles
      }

      .date {
          color: #4effd0 !important; // Turquoise color for smaller titles
      }
    }
  }
}
```

### Action Buttons Styling (`layout/explore/explore-datasets/explore-datasets-actions/_styles.scss`)

```scss
.c-explore-datasets-actions {
    display: flex;
    background: rgba(30, 30, 30, 0.85); // Dark semi-transparent background with blur effect
    backdrop-filter: blur(8px); // Glassmorphism effect

    button {
        &:not(:last-child) {
            margin-right: $space;
        }
        
        // Override button backgrounds to match container - most specific selectors
        &.c-button.-secondary.-compressed {
            background-color: rgba(30, 30, 30, 0.85) !important;
            color: #CCCCCC !important; // Less white - light gray
            fill: #CCCCCC !important; // Less white - light gray
            border: 2px solid #FFFFFF !important; // White border
            border-radius: 4px !important; // Ensure border radius is maintained
            
            // Override hover and active states
            &:hover {
                background-color: rgba(30, 30, 30, 0.85) !important;
                color: #CCCCCC !important;
                fill: #CCCCCC !important;
            }
            
            &:active {
                background-color: rgba(30, 30, 30, 0.85) !important;
                color: #CCCCCC !important;
                fill: #CCCCCC !important;
            }
        }
        
        &.c-button.-primary.-compressed {
            background-color: rgba(30, 30, 30, 0.85) !important;
            color: #CCCCCC !important; // Less white - light gray
            fill: #CCCCCC !important; // Less white - light gray
            border: 2px solid #FFFFFF !important; // White border
            border-radius: 4px !important; // Ensure border radius is maintained
            
            // Override hover and active states
            &:hover {
                background-color: rgba(30, 30, 30, 0.85) !important;
                color: #CCCCCC !important;
                fill: #CCCCCC !important;
            }
            
            &:active {
                background-color: rgba(30, 30, 30, 0.85) !important;
                color: #CCCCCC !important;
                fill: #CCCCCC !important;
            }
        }
    }
}
```

### Search Dropdown Styling (`components/datasets/search.scss`)

```scss
.search-dropdown {
  border-radius: 0 0 4px 4px;
  border: 1px solid rgba(255, 255, 255, 0.3); // Light white border
  border-top: none;
  background: #1E1E1E; // Pure dark color

  .search-dropdown-list {
    padding: $space-1 * 2;
    font-size: $font-size-normal;
    color: #FFFFFF; // Updated color to match header text

    .search-dropdown-list-item {
      margin: 0;
      border: none;

      h4 {
        display: inline-block;
        font-size: $font-size-normal;
        font-weight: 500; // Medium weight to match header
        font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        margin: 0;
        color: #FFFFFF; // Updated color to match header text
        border-bottom: 1px solid rgba(255, 255, 255, 0.2); // Light white border
      }

      .list-item-results {
        button {
          width: 100%;
          text-align: left;
          margin: 0;
          padding: 4px 8px;
          color: #FFFFFF; // Updated color to match header text
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
          font-weight: 500; // Medium weight to match header
          cursor: pointer;

          &.-active {
            background: rgba(255, 255, 255, 0.1); // Subtle white background
          }
        }
      }
    }
  }
}
```

## Functionality

### Menu Navigation
- **ALL DATA**: Shows all available datasets
- **TOPICS**: Filters datasets by topic categories
- **MY DATA**: Shows user's personal datasets (requires login)
- **MY FAVORITES**: Shows user's favorited datasets (requires login)

### Search Functionality
- **Database Search**: Search through available datasets
- **Filter Tags**: Selected filters appear as removable tags
- **Text Search**: Search by text content in datasets

### Dataset Actions
- **Add to Map**: Adds dataset to the map view
- **Star/Favorite**: Adds dataset to user's favorites
- **View Details**: Opens dataset detail page

### Interactive States
- **Hover Effects**: Turquoise color (`#4effd0`) on hover
- **Active States**: Subtle white background for active items
- **Focus States**: Proper keyboard navigation support

## Code Snippets

### Menu Component Structure (`explore-menu/component.jsx`)

```jsx
const ExploreMenu = ({
  token,
  open,
  options,
  tab,
  tags,
  search,
  selected,
  section,
  selectedCollection,
  setSidebarSection,
  setSidebarSelectedCollection,
  setFiltersOpen,
  setFiltersTab,
  userIsLoggedIn,
  selectedDataset,
  setDatasetsPage,
  fetchDatasets,
  resetFiltersSort,
  setSortSelected,
  setSortDirection,
  sortSelected,
  shouldAutoUpdateSortDirection,
  setFiltersSearch,
  toggleFiltersSelected,
  setFiltersSelected,
}) => {
  return (
    <div className={classnames({
      'c-explore-menu': true,
      '-hidden': selectedDataset,
    })}>
      <DatasetSearch
        open={open}
        tab={tab}
        list={tags}
        search={search}
        options={options}
        selected={selected}
        onChangeOpen={setFiltersOpen}
        onChangeTab={setFiltersTab}
        onChangeTextSearch={onChangeTextSearch}
        onToggleSelected={onToggleSelected}
        onChangeSelected={onChangeSelected}
      />

      <div className="menu-options">
        <div
          className={classnames({
            'menu-option': true,
            '-active': section === EXPLORE_SECTIONS.ALL_DATA,
          })}
          role="button"
          tabIndex={0}
          onKeyPress={() => {
            setSidebarSection(EXPLORE_SECTIONS.ALL_DATA);
          }}
          onClick={() => {
            setSidebarSection(EXPLORE_SECTIONS.ALL_DATA);
          }}
        >
          <span className="section-name">All Data</span>
        </div>
        {/* Additional menu options... */}
      </div>
    </div>
  );
};
```

### Dataset List Item Structure (`list-item/component.js`)

```jsx
class DatasetListItem extends React.Component {
  render() {
    const { dataset, metadata, actions, active, filters, sort, sidebar } = this.props;

    const dateLastUpdated = getDateConsideringTimeZone(dataset.dataLastUpdated, true);
    const classNameValue = classnames({
      'c-explore-dataset-list-item': true,
      '-active': active,
    });

    return (
      <div className={classNameValue}>
        <Media greaterThanOrEqual="md">{this.renderChart()}</Media>

        <Media at="sm">
          <Link href={`/data/explore/${dataset.slug}`}>{this.renderChart()}</Link>
        </Media>

        <div className="info">
          <div className="source-date">
            <div className="source" title={metadata && metadata.source}>
              {metadata && metadata.source}
            </div>
            <div className="date">{dateLastUpdated}</div>
          </div>

          <div className="title-actions">
            <h4>
              <Link href={`/data/explore/${dataset.slug}`}>
                <a className="line-clamp-2">
                  {(metadata && metadata.info && metadata.info.name) || dataset.name}
                </a>
              </Link>
            </h4>
            {actions && (
              <Media greaterThanOrEqual="md">
                {React.cloneElement(actions, { ...this.props })}
              </Media>
            )}
          </div>
        </div>
      </div>
    );
  }
}
```

### Action Buttons Structure (`explore-datasets-actions/component.jsx`)

```jsx
const ExploreDatasetsActions = ({
  dataset,
  layer,
  active,
  selectedCollection,
  onToggleLayerGroup,
  onToggleFavorite,
  onToggleCollection,
  getTooltipContainer,
}) => {
  const isActive = active;
  const isInACollection = selectedCollection;

  const starIconName = classnames({
    'icon-star': isInACollection,
    'icon-star-empty': !isInACollection,
  });

  return (
    <div className="c-explore-datasets-actions">
      <button
        className={classnames({
          'c-button': true,
          '-secondary': !isActive,
          '-primary': isActive,
          '-compressed': true,
          '-disable': !layer,
          '-fullwidth': true,
        })}
        type="button"
        disabled={!layer}
        onClick={handleToggleLayerGroup}
      >
        {isActive ? 'Active' : 'Add to map'}
      </button>
      <LoginRequired>
        <Tooltip
          overlay={
            <CollectionsPanel
              resource={dataset}
              resourceType="dataset"
              onClick={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
              onToggleFavorite={handleToggleFavorite}
              onToggleCollection={handleToggleCollection}
            />
          }
          overlayClassName="c-rc-tooltip"
          placement="bottomRight"
          trigger="click"
          getTooltipContainer={getTooltipContainer}
          monitorWindowResize
        >
          <button
            type="button"
            className="c-button -secondary -compressed"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Icon name={starIconName} className={starIconClass} />
          </button>
        </Tooltip>
      </LoginRequired>
    </div>
  );
};
```

## Modification Guide

### Changing Colors

#### Background Colors
To change the background color of any panel, modify the `background` property:

```scss
// For dark semi-transparent background
background: rgba(30, 30, 30, 0.85);
backdrop-filter: blur(8px);

// For solid dark background
background: #1E1E1E;

// For pure dark background
background: #000000;
```

#### Text Colors
To change text colors:

```scss
// Main text color
color: #FFFFFF;

// Accent/hover color
color: #4effd0;

// Small titles color
color: #4effd0;
```

#### Border Colors
To change border colors:

```scss
// White borders
border-color: #FFFFFF;

// Light white borders
border-color: rgba(255, 255, 255, 0.3);

// Turquoise borders
border-color: #4effd0;
```

### Changing Dimensions

#### Panel Heights
To modify panel heights:

```scss
// Main sidebar height
height: calc(100% - 320px);

// Menu panel height
height: calc(100% - 1320px);

// Content panel height
height: calc(100vh - 100px);
```

#### Panel Widths
To modify panel widths:

```scss
// Menu panel width
min-width: 180px;
max-width: 180px;

// Content panel positioning
left: 180px;
```

### Adding New Menu Options

1. **Add to constants**: Define the new section in `EXPLORE_SECTIONS`
2. **Update component**: Add the new option to `explore-menu/component.jsx`
3. **Style if needed**: Add specific styling in `_styles.scss`

### Modifying Font Styles

#### Font Family
```scss
font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
```

#### Font Weight
```scss
font-weight: 500; // Medium weight
font-weight: 200; // Light weight
font-weight: bold; // Bold weight
```

#### Font Size
```scss
font-size: 14px; // Standard size
font-size: calc(1em - 0.5px); // Relative size
```

#### Text Transform
```scss
text-transform: uppercase; // Uppercase
text-transform: lowercase; // Lowercase
text-transform: none; // No transform
```

#### Letter Spacing
```scss
letter-spacing: 0.1em; // Standard spacing
letter-spacing: 0.05em; // Tighter spacing
letter-spacing: 0.2em; // Wider spacing
```

### Troubleshooting

#### Common Issues

1. **Styling not applying**: Check CSS specificity and use `!important` if needed
2. **Blur effects not working**: Ensure `backdrop-filter` is supported by the browser
3. **Positioning issues**: Check parent container positioning and z-index values
4. **Text not visible**: Verify color contrast between text and background

#### Browser Compatibility

- **Backdrop Filter**: Supported in modern browsers (Chrome 76+, Firefox 103+, Safari 9+)
- **CSS Grid**: Supported in all modern browsers
- **Flexbox**: Supported in all modern browsers

### Performance Considerations

- **Backdrop Filter**: Can impact performance on lower-end devices
- **Z-index**: Keep z-index values low to avoid stacking context issues
- **Transitions**: Use `transform` and `opacity` for smooth animations
- **Overflow**: Set `overflow: visible` to allow content to extend beyond containers

## Conclusion

This documentation provides a complete guide to understanding and modifying the left sidebar panel configuration. All styling, functionality, and integration details are covered to enable easy maintenance and customization of the sidebar components.

For any questions or additional modifications, refer to the specific file sections mentioned in this document or consult the React component documentation for the interactive elements.