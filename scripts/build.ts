import fs           from 'fs'
import * as esbuild from 'esbuild'

type Loader = 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'json' | 'text' | 'base64' | 'dataurl' | 'file' | 'binary'

interface BuildOptions {
  bundle       : boolean
  minify       : boolean
  sourcemap    : boolean
  target       : string[]
  entryPoints? : string[]
  outfile?     : string
  format?      : 'esm' | 'iife'
  loader?      : { [ext: string]: Loader }
}

async function build(): Promise<void> {
  const watch = process.argv.includes('--watch')

  // Copy public files
  fs.cpSync('./public', './dist', { recursive: true })

  // Build options
  const commonOptions: BuildOptions = {
    bundle    : true,
    minify    : !watch,
    sourcemap : watch,
    target    : ['chrome58', 'firefox57', 'safari11', 'edge18'],
  }

  // Build app
  const appBuildOptions: BuildOptions = {
    ...commonOptions,
    entryPoints : ['src/index.tsx'],
    outfile     : 'dist/app.js',
    format      : 'esm',
    loader      : {
      '.tsx' : 'tsx',
      '.ts  ': 'ts',
    },
  }

  // Build service worker
  const swBuildOptions: BuildOptions = {
    ...commonOptions,
    entryPoints : ['src/sw.ts'],
    outfile     : 'dist/sw.js',
    format      : 'iife',
    loader      : {
      '.tsx' : 'tsx',
      '.ts'  : 'ts',
    },
  }

  if (watch) {
    // Use context API for watch mode
    const appContext = await esbuild.context(appBuildOptions)
    const swContext  = await esbuild.context(swBuildOptions)
    
    await Promise.all([
      appContext.watch(),
      swContext.watch()
    ])
    
    console.log('[ build ] watching for changes...')
  } else {
    // One-time build
    await Promise.all([
      esbuild.build(appBuildOptions),
      esbuild.build(swBuildOptions)
    ])
    
    console.log('[ build ] build complete')
  }
}

// Run the build function and handle errors
build().catch(err => {
  console.error('[ build ] build failed:', err)
  process.exit(1)
})
