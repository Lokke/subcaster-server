/**
 * WebGPU Utilities for SubCaster
 * Provides WebGPU acceleration for audio processing, waveform rendering, and UI
 */

// Type definitions for WebGPU (until official types are available)
declare global {
  interface Navigator {
    gpu?: any;
  }
}

interface WebGPUContext {
  adapter: any;
  device: any;
  isAvailable: boolean;
}

let webgpuContext: WebGPUContext | null = null;

/**
 * Initialize WebGPU context
 * @returns WebGPU context or null if not available
 */
export async function initWebGPU(): Promise<WebGPUContext | null> {
  if (webgpuContext) {
    return webgpuContext;
  }

  // Check if WebGPU is available from early init
  if ((window as any).__webgpu) {
    console.log('🚀 Using pre-initialized WebGPU context');
    webgpuContext = {
      ...(window as any).__webgpu,
      isAvailable: true
    };
    return webgpuContext;
  }

  // Try to initialize WebGPU
  if (!('gpu' in navigator)) {
    console.log('ℹ️ WebGPU not supported in this browser');
    return null;
  }

  try {
    console.log('🚀 Initializing WebGPU...');
    
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!adapter) {
      console.warn('⚠️ WebGPU: No adapter available');
      return null;
    }

    const device = await adapter.requestDevice();
    
    webgpuContext = {
      adapter,
      device,
      isAvailable: true
    };

    console.log('✅ WebGPU initialized successfully');
    console.log('📊 Adapter info:', {
      features: Array.from(adapter.features),
      limits: adapter.limits
    });

    return webgpuContext;
  } catch (err) {
    console.error('❌ Failed to initialize WebGPU:', err);
    return null;
  }
}

/**
 * Get current WebGPU context (internal use only)
 */
function getWebGPU(): WebGPUContext | null {
  return webgpuContext;
}

/**
 * Check if WebGPU is available
 */
export function isWebGPUAvailable(): boolean {
  return webgpuContext?.isAvailable || false;
}

// Removed unused exports: createGPUBuffer, processAudioGPU

/**
 * Enable hardware acceleration features
 */
export function enableHardwareAcceleration() {
  console.log('🚀 Enabling hardware acceleration features...');
  
  // Enable CSS hardware acceleration
  document.documentElement.style.transform = 'translateZ(0)';
  document.documentElement.style.willChange = 'transform';
  
  // Enable canvas hardware acceleration
  const canvases = document.querySelectorAll('canvas');
  canvases.forEach(canvas => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      (ctx as any).imageSmoothingQuality = 'high';
    }
  });
  
  console.log('✅ Hardware acceleration features enabled');
}

// Auto-initialize on module load
initWebGPU().then(ctx => {
  if (ctx) {
    console.log('🎉 WebGPU ready for use');
    enableHardwareAcceleration();
  } else {
    console.log('ℹ️ Falling back to CPU processing');
  }
});
