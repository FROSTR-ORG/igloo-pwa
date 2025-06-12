export function Header () {
  return (
    <div className="page-header">
      <img
        src="/icons/logo.png" 
        alt="Frost Logo" 
        className="frost-logo"
      />
      <div className="title-container">
        <h1>FROSTR Web</h1>
      </div>
      <p>Enterprise security for the individual.</p>
      <a 
        href="https://frostr.org" 
        target="_blank" 
        rel="noopener noreferrer"
      >
        https://frostr.org
      </a>
      <div className="alpha-pill alpha-pill-standalone">alpha edition</div>
    </div>
  )
}
