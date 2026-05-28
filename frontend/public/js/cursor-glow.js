/**
 * Glowing Cursor Effect
 * Creates a smooth glowing light effect that follows the mouse cursor
 */

class CursorGlow {
  constructor() {
    this.cursor = null;
    this.isVisible = false;
    this.isInteractive = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.animationId = null;
    
    this.init();
  }

  init() {
    // Create cursor glow element
    this.createCursorElement();
    
    // Add event listeners
    this.addEventListeners();
    
    // Start animation loop
    this.animate();
    
    // Add body class for cursor hiding
    document.body.classList.add('has-cursor-glow');
    
    // Debug: Add a test button to verify the effect is working
    this.addTestButton();
    
    console.log('🎯 Cursor glow initialized successfully');
  }

  createCursorElement() {
    this.cursor = document.createElement('div');
    this.cursor.className = 'cursor-glow';
    this.cursor.style.display = 'none';
    this.cursor.style.position = 'fixed';
    this.cursor.style.zIndex = '2147483647';
    document.body.appendChild(this.cursor);
    
    // Debug: Log that cursor was created
    console.log('🎯 Cursor glow element created:', this.cursor);
  }

  addEventListeners() {
    // Mouse move event
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      
      if (!this.isVisible) {
        this.show();
      }
    });

    // Mouse enter/leave events for interactive elements
    document.addEventListener('mouseover', (e) => {
      if (this.isInteractiveElement(e.target)) {
        this.setInteractive(true);
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (this.isInteractiveElement(e.target)) {
        this.setInteractive(false);
      }
    });

    // Hide cursor when leaving window
    document.addEventListener('mouseleave', () => {
      this.hide();
    });

    // Show cursor when entering window
    document.addEventListener('mouseenter', () => {
      this.show();
    });

    // Handle scroll events
    window.addEventListener('scroll', () => {
      // Update cursor position on scroll
      this.updatePosition();
    });

    // Handle resize events
    window.addEventListener('resize', () => {
      // Update cursor position on resize
      this.updatePosition();
    });
  }

  isInteractiveElement(element) {
    const interactiveSelectors = [
      'button', 'a', 'input', 'textarea', 'select',
      '[role="button"]', '[tabindex]', '.c-btn', '.c-button'
    ];
    
    return interactiveSelectors.some(selector => 
      element.matches(selector) || element.closest(selector)
    );
  }

  setInteractive(interactive) {
    if (this.isInteractive !== interactive) {
      this.isInteractive = interactive;
      this.cursor.classList.toggle('interactive', interactive);
    }
  }

  show() {
    if (!this.isVisible) {
      this.isVisible = true;
      this.cursor.style.display = 'block';
      this.cursor.classList.remove('hidden');
    }
  }

  hide() {
    if (this.isVisible) {
      this.isVisible = false;
      this.cursor.classList.add('hidden');
      setTimeout(() => {
        if (!this.isVisible) {
          this.cursor.style.display = 'none';
        }
      }, 200);
    }
  }

  updatePosition() {
    if (this.cursor) {
      // Position the glow directly at cursor position
      this.targetX = this.mouseX;
      this.targetY = this.mouseY;
      
      this.cursor.style.left = this.targetX + 'px';
      this.cursor.style.top = this.targetY + 'px';
      
      // Debug: Log position updates occasionally
      if (Math.random() < 0.01) { // Log 1% of the time to avoid spam
        console.log('🎯 Cursor position updated:', this.targetX, this.targetY);
      }
    }
  }

  animate() {
    // Smooth cursor following with easing
    const ease = 0.15;
    
    if (this.cursor && this.isVisible) {
      const currentX = parseFloat(this.cursor.style.left) || this.targetX;
      const currentY = parseFloat(this.cursor.style.top) || this.targetY;
      
      const newX = currentX + (this.targetX - currentX) * ease;
      const newY = currentY + (this.targetY - currentY) * ease;
      
      this.cursor.style.left = newX + 'px';
      this.cursor.style.top = newY + 'px';
    }
    
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    if (this.cursor) {
      this.cursor.remove();
    }
    
    document.body.classList.remove('has-cursor-glow');
  }

  addTestButton() {
    // Create a test button to verify the cursor glow is working
    const testBtn = document.createElement('button');
    testBtn.textContent = '🎯 Cursor Glow Test';
    testBtn.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 2147483646;
      background: #4effd0;
      color: white;
      border: none;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    
    testBtn.addEventListener('click', () => {
      alert('Cursor glow is working! Check console for debug info.');
      console.log('🎯 Test button clicked - cursor glow is active');
      console.log('🎯 Cursor element:', this.cursor);
      console.log('🎯 Cursor visible:', this.isVisible);
    });
    
    document.body.appendChild(testBtn);
    
    // Auto-remove test button after 10 seconds
    setTimeout(() => {
      if (testBtn.parentNode) {
        testBtn.remove();
      }
    }, 10000);
  }
}

// Initialize cursor glow when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.cursorGlow = new CursorGlow();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CursorGlow;
}
