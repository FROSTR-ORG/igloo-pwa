import fs           from 'fs'
import * as esbuild from 'esbuild'
import path         from 'path'

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
  alias?       : { [pkg: string]: string }
  resolveExtensions?: string[]
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
    alias     : {
      '@': path.resolve('src')
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.css', '.json']
  }

  // Build app
  const appBuildOptions: BuildOptions = {
    ...commonOptions,
    entryPoints : ['src/index.tsx'],
    outfile     : 'dist/app.js',
    format      : 'esm',
    loader      : {
      '.tsx' : 'tsx',
      '.ts'  : 'ts',
      '.css' : 'css',
      '.png' : 'file',
      '.jpg' : 'file',
      '.svg' : 'file',
      '.gif' : 'file',
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

  // Additional plugins for CSS processing
  const cssPlugin = {
    name: 'css',
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, args => {
        // Handle CSS imports
        const filePath = path.resolve(args.resolveDir, args.path)
        return { path: filePath, namespace: 'css-ns' }
      })

      build.onLoad({ filter: /.*/, namespace: 'css-ns' }, async (args) => {
        // Load and inject CSS
        const css = await fs.promises.readFile(args.path, 'utf8')
        const escaped = css.replace(/`/g, '\\`').replace(/\$/g, '\\$')
        const contents = `
          const style = document.createElement('style')
          style.type = 'text/css'
          style.appendChild(document.createTextNode(\`${escaped}\`))
          document.head.appendChild(style)
        `
        return { contents, loader: 'js' }
      })
    }
  }

  if (watch) {
    // Use context API for watch mode
    const appContext = await esbuild.context({
      ...appBuildOptions,
      plugins: [cssPlugin]
    })
    
    const swContext  = await esbuild.context(swBuildOptions)
    
    await Promise.all([
      appContext.watch(),
      swContext.watch()
    ])
    
    console.log('[ build ] watching for changes...')
  } else {
    // One-time build
    await Promise.all([
      esbuild.build({
        ...appBuildOptions,
        plugins: [cssPlugin]
      }),
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
