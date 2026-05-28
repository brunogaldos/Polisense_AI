# Right Side Location Panel Configuration Documentation

## Overview
This document provides comprehensive documentation for the right-side location panel (map controls) in the Resource Watch application. It covers map controls, boundaries functionality, styling, and customization options.

## Table of Contents
1. [Panel Structure](#panel-structure)
2. [Map Controls](#map-controls)
3. [Boundaries Configuration](#boundaries-configuration)
4. [File Structure](#file-structure)
5. [Component Integration](#component-integration)
6. [Styling Details](#styling-details)
7. [Functionality](#functionality)
8. [Code Snippets](#code-snippets)
9. [Modification Guide](#modification-guide)
10. [Troubleshooting](#troubleshooting)

## Panel Structure

The right-side location panel consists of several map control components:

### 1. Map Controls Container (`MapControls`)
- **Purpose**: Parent container for all map control elements
- **Position**: Fixed positioning on the right side of the map
- **Components**: Contains zoom, share, basemap, search, and reset view controls

### 2. Basemap Controls (`BasemapControls`)
- **Purpose**: Controls map basemap, labels, and boundaries
- **Location**: Right side of the map
- **Functionality**: Dropdown menu with basemap options, label options, and boundaries toggle

### 3. Other Controls
- **Zoom Controls**: Zoom in/out functionality
- **Share Controls**: Map sharing functionality
- **Search Controls**: Location search functionality
- **Reset View Controls**: Reset map to default view

## Map Controls

### Basemap Control Component
The basemap control provides access to:
- **Basemap Selection**: Different map styles (dark, light, satellite, terrain, hydrography)
- **Label Options**: Label visibility and style options
- **Boundaries Toggle**: Show/hide map boundaries with custom color

### Control Button
- **Icon**: Layers icon (`icon-layers`)
- **Size**: 32px × 32px
- **Background**: White with shadow
- **Hover Effect**: Light grey background

## Boundaries Configuration

### Current Implementation
The boundaries functionality includes:
- **Toggle Control**: Checkbox to enable/disable boundaries
- **Dynamic Color**: Boundaries change to turquoise (#4effd0) when activated
- **Layer Management**: Programmatic control of boundary layer visibility and styling

### Color Configuration
- **Default Color**: White (from Mapbox style)
- **Active Color**: `#4effd0` (Turquoise)
- **Application**: Applied to all boundary line layers when activated

## File Structure

```
resource-watch/
├── components/
│   └── map/
│       ├── component.tsx                    # Main map component
│       ├── constants.ts                     # Map constants and configurations
│       ├── controls/
│       │   └── basemap/
│       │       ├── component.jsx            # Basemap controls component
│       │       └── _styles.scss            # Basemap controls styling
│       └── plugins/
│           └── drawer/
│               └── constants.js             # Drawing tool constants
├── css/
│   └── components/
│       └── form/
│           └── checkbox.scss               # Checkbox styling
└── layout/
    └── explore/
        └── explore-map/
            ├── component.jsx                # Explore map integration
            └── _styles.scss                 # Map styling
```

## Component Integration

### Map Component Integration
The map component integrates with:
- **React Map GL**: Map rendering and interaction
- **Mapbox GL JS**: Map styling and layer management
- **Control Components**: Basemap, zoom, share, search, and reset controls

### Basemap Controls Integration
The basemap controls integrate with:
- **Tether**: Dropdown positioning
- **RadioGroup**: Basemap and label selection
- **Checkbox**: Boundaries toggle
- **Icon**: Control button icon

## Styling Details

### Basemap Control Styling (`components/map/controls/basemap/_styles.scss`)

```scss
.c-basemap-control {
  > .basemap-control--btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: math.div($space, 2);
    border-radius: 3px;
    box-shadow: 0 1px 1px 0 rgba($black, .5);
    background-color: $white;
    cursor: pointer;

    > svg {
      fill: $charcoal-grey;
    }

    &:hover {
      background: $porcelain;
    }
  }
}
```

### Checkbox Styling (`css/components/form/checkbox.scss`)

```scss
.c-checkbox {
  label {
    display: block;
    padding: 2px 0;
    text-transform: none;
    position: relative;
    padding-left: 14px;
    font-size: $font-size-normal;
    line-height: 1;
    cursor: pointer;
    width: auto;
    top: 0;
    left: 0;
    transform: none;
    text-align: left;
    color: $charcoal-grey;
    margin-left: 0;

    &:hover {
      color: lighten($charcoal-grey, 12.5%);
    }

    .checkbox-icon {
      position: absolute;
      top: 50%;
      left: 0;
      width: 14px;
      height: 14px;
      margin-right: 5px;
      border: 1px solid $sea-blue;
      border-radius: 4px;
      transform: translate(0,-50%);

      &:after {
        content: "";
        position: absolute;
        display: block;
        top: calc(50% - 1px);
        left: 50%;
        width: 6px;
        height: 3px;
        border-left: 1px solid $sea-blue;
        border-bottom: 1px solid $sea-blue;
        transform: translate(-50%,-50%) rotate(-40deg) scale(0);
        transition: all .16s cubic-bezier(0.445, 0.050, 0.550, 0.950);
      }
    }

    .item-title {
      display: inline-block;
      margin-left: 5px;
    }
  }

  input[type=checkbox] {
    display: none;
  }

  input[type=checkbox]:checked + label {
    color: #4effd0; // Turquoise color when checked

    .checkbox-icon {
      border-color: #4effd0; // Turquoise border when checked
      
      &:after {
        transform: translate(-50%,-50%) rotate(-40deg) scale(1);
        border-left-color: #4effd0; // Turquoise checkmark
        border-bottom-color: #4effd0; // Turquoise checkmark
      }
    }
  }
}
```

## Functionality

### Map Controls Functionality
- **Basemap Selection**: Switch between different map styles
- **Label Control**: Toggle label visibility and style
- **Boundaries Toggle**: Show/hide map boundaries with custom color
- **Zoom Control**: Zoom in/out on the map
- **Share Control**: Share map view
- **Search Control**: Search for locations
- **Reset View**: Reset map to default viewport

### Boundaries Functionality
- **Toggle Visibility**: Show/hide boundary layers
- **Dynamic Coloring**: Change boundary color when activated
- **Layer Management**: Control individual boundary layer properties
- **Real-time Updates**: Immediate visual feedback

### Interactive States
- **Hover Effects**: Visual feedback on control buttons
- **Active States**: Clear indication of selected options
- **Focus States**: Keyboard navigation support

## Code Snippets

### Map Component Boundaries Handler (`components/map/component.tsx`)

```typescript
const handleBoundaries = useCallback(
  (boundaries: boolean) => {
    const { current: map } = mapRef;
    const LABELS_GROUP = ['boundaries'];
    const { layers, metadata } = map.getStyle();

    const boundariesGroups = Object.keys(metadata['mapbox:groups']).filter((k) => {
      const { name } = metadata['mapbox:groups'][k];

      const labelsGroup = LABELS_GROUP.map((rgr) => name.toLowerCase().includes(rgr));

      return labelsGroup.some((bool) => bool);
    });

    const boundariesLayers = layers.filter((l) => {
      const { metadata: layerMetadata } = l;
      if (!layerMetadata) return false;

      const gr = layerMetadata['mapbox:group'];
      return boundariesGroups.includes(gr);
    });

    boundariesLayers.forEach((l) => {
      map.setLayoutProperty(l.id, 'visibility', boundaries ? 'visible' : 'none');
      
      // Change boundary color to turquoise when visible
      if (boundaries && l.type === 'line') {
        map.setPaintProperty(l.id, 'line-color', '#4effd0');
      }
    });
  },
  [mapRef],
);
```

### Basemap Controls Component (`components/map/controls/basemap/component.jsx`)

```jsx
export default function BasemapControls({
  basemap,
  labels,
  boundaries,
  disabledControls,
  onChangeBasemap,
  onChangeLabels,
  onChangeBoundaries,
}) {
  const [active, setActive] = useState(false);
  let basemapSelectorRef = useRef(null);

  const onBoundariesChange = useCallback(
    (nextBoundaries) => {
      onChangeBoundaries?.(nextBoundaries.checked);
    },
    [onChangeBoundaries],
  );

  return (
    <div className="c-basemap-control">
      <Tether
        attachment="top right"
        constraints={[{ to: 'window' }]}
        targetOffset="8px 100%"
        classes={{ element: 'c-tooltip -arrow-right' }}
        renderTarget={(ref) => (
          <button ref={ref} type="button" className="basemap-control--btn" onClick={toggleDropdown}>
            <Icon name="icon-layers" className="-small" />
          </button>
        )}
        renderElement={(ref) => {
          basemapSelectorRef = ref;

          if (!active) return null;

          return (
            <div ref={ref}>
              <RadioGroup
                name="basemap"
                options={basemapOptions}
                properties={{ default: basemap.id }}
                onChange={onBasemapChange}
              />

              <div className="divisor" />

              <RadioGroup
                name="labels"
                options={labelsOptions}
                properties={{
                  default: labels.id,
                  value: labels.id,
                }}
                onChange={onLabelsChange}
              />

              {!disableBoundariesControls && (
                <>
                  <div className="divisor" />
                  <Checkbox
                    properties={{
                      name: 'boundaries',
                      title: 'Boundaries',
                      value: 'boundaries',
                      checked: boundaries,
                    }}
                    onChange={onBoundariesChange}
                  />
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
```

### Map Constants (`components/map/constants.ts`)

```typescript
export const MAPSTYLES = 'mapbox://styles/resourcewatch/cjzmw480d00z41cp2x81gm90h';

export const BASEMAPS = {
  dark: {
    id: 'dark',
    value: 'dark',
    label: 'Dark',
    options: {
      attribution:
        '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="http://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>',
    },
  },
  light: {
    id: 'light',
    value: 'light',
    label: 'Light',
    options: {
      attribution:
        '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="http://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>',
    },
  },
  satellite: {
    id: 'satellite',
    value: 'satellite',
    label: 'Satellite',
    options: {
      attribution:
        '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="http://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>',
    },
  },
  terrain: {
    id: 'terrain',
    value: 'terrain',
    label: 'Terrain',
    options: {
      attribution:
        '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="http://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>',
    },
  },
  aqueduct: {
    id: 'aqueduct',
    value: 'aqueduct',
    label: 'Hydrography',
    options: {
      attribution:
        '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="http://www.openstreetmap.org/about/" target="_blank">© OpenStreetMap</a>',
    },
  },
};

export const LABELS = {
  none: {
    id: 'none',
    label: 'No labels',
    value: 'none',
  },
  light: {
    id: 'light',
    label: 'Labels light',
    value: 'light',
  },
  dark: {
    id: 'dark',
    label: 'Labels dark',
    value: 'dark',
  },
};

export const BOUNDARIES = {
  dark: {
    id: 'dark',
    label: 'Boundaries',
    value: false,
  },
};
```

## Modification Guide

### Changing Boundary Colors

#### Method 1: Modify the handleBoundaries Function
To change the boundary color, modify the `line-color` property in the `handleBoundaries` function:

```typescript
// In components/map/component.tsx
boundariesLayers.forEach((l) => {
  map.setLayoutProperty(l.id, 'visibility', boundaries ? 'visible' : 'none');
  
  // Change boundary color when visible
  if (boundaries && l.type === 'line') {
    map.setPaintProperty(l.id, 'line-color', '#YOUR_COLOR_HERE');
  }
});
```

#### Method 2: Add Multiple Color Options
To support multiple boundary color options:

```typescript
const handleBoundaries = useCallback(
  (boundaries: boolean, color: string = '#4effd0') => {
    const { current: map } = mapRef;
    // ... existing code ...
    
    boundariesLayers.forEach((l) => {
      map.setLayoutProperty(l.id, 'visibility', boundaries ? 'visible' : 'none');
      
      if (boundaries && l.type === 'line') {
        map.setPaintProperty(l.id, 'line-color', color);
      }
    });
  },
  [mapRef],
);
```

#### Method 3: Add Boundary Width Control
To also control boundary line width:

```typescript
boundariesLayers.forEach((l) => {
  map.setLayoutProperty(l.id, 'visibility', boundaries ? 'visible' : 'none');
  
  if (boundaries && l.type === 'line') {
    map.setPaintProperty(l.id, 'line-color', '#4effd0');
    map.setPaintProperty(l.id, 'line-width', 2); // Add width control
  }
});
```

### Adding New Basemap Options

1. **Update Constants**: Add new basemap to `BASEMAPS` in `constants.ts`:

```typescript
export const BASEMAPS = {
  // ... existing basemaps ...
  custom: {
    id: 'custom',
    value: 'custom',
    label: 'Custom Style',
    options: {
      attribution: 'Custom attribution',
    },
  },
};
```

2. **Update Mapbox Style**: Ensure the new basemap style exists in Mapbox Studio
3. **Test Integration**: Verify the new basemap works correctly

### Modifying Control Button Styling

#### Button Size
```scss
.basemap-control--btn {
  width: 40px; // Change from 32px
  height: 40px; // Change from 32px
}
```

#### Button Colors
```scss
.basemap-control--btn {
  background-color: #1E1E1E; // Dark background
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); // Different shadow
  
  > svg {
    fill: #FFFFFF; // White icon
  }

  &:hover {
    background: #404040; // Dark hover
  }
}
```

#### Button Position
```scss
.c-basemap-control {
  position: fixed;
  top: 20px; // Adjust vertical position
  right: 20px; // Adjust horizontal position
  z-index: 1000;
}
```

### Customizing Checkbox Styling

#### Checkbox Colors
```scss
input[type=checkbox]:checked + label {
  color: #YOUR_COLOR; // Text color when checked

  .checkbox-icon {
    border-color: #YOUR_COLOR; // Border color when checked
    
    &:after {
      border-left-color: #YOUR_COLOR; // Checkmark color
      border-bottom-color: #YOUR_COLOR; // Checkmark color
    }
  }
}
```

#### Checkbox Size
```scss
.checkbox-icon {
  width: 18px; // Change from 14px
  height: 18px; // Change from 14px
  border-radius: 6px; // Change from 4px
}
```

### Adding New Control Types

1. **Create Control Component**:

```jsx
// components/map/controls/custom/component.jsx
export default function CustomControl({ onCustomAction }) {
  return (
    <div className="c-custom-control">
      <button 
        type="button" 
        className="custom-control--btn"
        onClick={onCustomAction}
      >
        <Icon name="icon-custom" className="-small" />
      </button>
    </div>
  );
}
```

2. **Add Styling**:

```scss
// components/map/controls/custom/_styles.scss
.c-custom-control {
  > .custom-control--btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 3px;
    background-color: $white;
    cursor: pointer;
    
    &:hover {
      background: $porcelain;
    }
  }
}
```

3. **Integrate with Map**:

```jsx
// In map component
<MapControls>
  <ZoomControls viewport={viewport} onClick={handleZoom} />
  <ShareControls />
  <BasemapControls {...basemapProps} />
  <CustomControl onCustomAction={handleCustomAction} />
  <SearchControls onSelectLocation={handleSearch} />
  <ResetViewControls className={resetViewBtnClass} onResetView={handleResetView} />
</MapControls>
```

## Troubleshooting

### Common Issues

#### Boundaries Not Changing Color
- **Check Mapbox Style**: Ensure the style supports dynamic color changes
- **Verify Layer Types**: Confirm boundary layers are of type 'line'
- **Check Layer IDs**: Verify boundary layer IDs are correctly identified

#### Controls Not Appearing
- **Check Z-index**: Ensure controls have proper z-index values
- **Verify Positioning**: Check CSS positioning properties
- **Check Component Mounting**: Ensure components are properly mounted

#### Checkbox Not Styling Correctly
- **CSS Specificity**: Use `!important` if needed to override styles
- **Check Selectors**: Verify CSS selectors match the HTML structure
- **Browser Compatibility**: Test across different browsers

### Performance Considerations

#### Map Performance
- **Layer Management**: Minimize the number of dynamic layer updates
- **Paint Properties**: Use efficient paint property updates
- **Memory Management**: Clean up event listeners and references

#### Control Performance
- **Event Handling**: Use `useCallback` for event handlers
- **Re-rendering**: Minimize unnecessary re-renders
- **State Management**: Use efficient state management patterns

### Browser Compatibility

#### Mapbox GL JS
- **Modern Browsers**: Requires modern browser with WebGL support
- **Mobile Support**: Test on mobile devices for touch interactions
- **Fallbacks**: Provide fallbacks for unsupported browsers

#### CSS Features
- **Flexbox**: Supported in all modern browsers
- **CSS Grid**: Supported in modern browsers
- **Custom Properties**: Supported in modern browsers

## Conclusion

This documentation provides a complete guide to understanding and modifying the right-side location panel (map controls). All functionality, styling, and integration details are covered to enable easy maintenance and customization of the map control components.

The boundaries functionality is particularly flexible, allowing for dynamic color changes and real-time updates. The modular structure makes it easy to add new controls or modify existing ones.

For any questions or additional modifications, refer to the specific file sections mentioned in this document or consult the Mapbox GL JS documentation for advanced map styling options.

