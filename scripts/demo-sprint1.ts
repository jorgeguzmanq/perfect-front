#!/usr/bin/env node
/**
 * Demo Sprint 1: detectProject + comment-storage
 *
 * Ejecutar con: node --experimental-strip-types scripts/demo-sprint1.ts
 */
import { cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProject, explainDetection } from "@perfect-front/project-detector";
import { CommentStorage, renderMarkdown } from "@perfect-front/comment-storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const fixtureDir = path.join(repoRoot, "packages", "project-detector", "fixtures", "vite-react-pnpm");

async function main() {
  const tmpRoot = os.tmpdir();
  const tempDir = path.join(tmpRoot, `pf-demo-${Date.now()}`);

  try {
    // 1. Copy fixture
    console.log(`\n✓ Copiando fixture a: ${tempDir}`);
    cpSync(fixtureDir, tempDir, { recursive: true });

    // 2. Detect project
    console.log(`\n✓ Ejecutando detectProject...`);
    const detection = detectProject({ cwd: tempDir });
    console.log(`  Framework: ${detection.framework.bundler}/${detection.framework.ui}`);
    console.log(`  Package Manager: ${detection.packageManager.name}@${detection.packageManager.version}`);
    console.log(`  Command: ${detection.plan.command} ${detection.plan.args.join(" ")}`);
    console.log(`  URL: ${detection.url}`);
    console.log(`  Reasons: ${explainDetection(detection)}`);

    // 3. Init comment storage
    console.log(`\n✓ Inicializando CommentStorage en ${path.join(tempDir, ".perfect-front")}`);
    const storage = await CommentStorage.init(tempDir);
    console.log(`  Config created: ${storage.initReport.createdConfig}`);

    // 4. Create a simulated comment
    console.log(`\n✓ Creando comentario simulado...`);
    const commentInput = {
      version: 1,
      scope: "element" as const,
      comment: "Este botón debería ocupar todo el ancho en móvil.",
      location: {
        url: "http://localhost:5173/pricing",
        route: "/pricing",
        title: "Precios",
        selector: "main button.buy",
        selectorCandidates: ["main button.buy"],
        text: "Comprar",
        html: '<button class="buy">Comprar</button>',
        componentHint: null,
      },
      viewport: { width: 390, height: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      elementRect: { x: 20, y: 601, width: 350, height: 44 },
      environment: { framework: "vite-react", browser: "Chrome", colorScheme: "dark" },
    };
    const comment = await storage.createComment(commentInput);
    console.log(`  ID: ${comment.id}`);
    console.log(`  Status: ${comment.status}`);
    console.log(`  Collection: ${comment.collection}`);

    // 5. Create another collection
    console.log(`\n✓ Creando colección 'mobile'...`);
    await storage.createCollection("mobile");

    // 6. Move comment to another collection
    console.log(`\n✓ Moviendo comentario a 'mobile'...`);
    const moved = await storage.moveComment(comment.id, "mobile");
    console.log(`  Nueva colección: ${moved.collection}`);
    console.log(`  ID se mantiene: ${moved.id === comment.id ? "sí" : "no"}`);

    // 7. List all comments
    console.log(`\n✓ Listando todos los comentarios...`);
    const { comments, errors } = await storage.listComments();
    console.log(`  Total: ${comments.length}`);
    console.log(`  Errores: ${errors.length}`);

    // 8. Export markdown
    console.log(`\n✓ Exportando a Markdown...`);
    const markdown = renderMarkdown(comments, { generatedAt: new Date().toISOString() });
    console.log(`  Líneas: ${markdown.split("\n").length}`);
    console.log(`\n  Contenido:\n${markdown.slice(0, 300)}...`);

    console.log(`\n✓ Demo completado exitosamente`);
  } finally {
    // Cleanup
    console.log(`\n✓ Limpiando: ${tempDir}`);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
