// Arquivos SVG importados como texto (loader "text" do esbuild) para serem inseridos inline.
declare module '*.svg' {
  const content: string;
  export default content;
}
declare module '*.css';
