const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

let lastTime = 0;

function gameLoop(time: number) {
  const dt = (time - lastTime) / 1000;
  lastTime = time;

  update(dt);
  render();

  requestAnimationFrame(gameLoop);
}

function update(dt: number) {
  // TODO: Simulation update
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Placeholder render
  ctx.fillStyle = "white";
  ctx.font = "20px Arial";
  ctx.fillText("Tower Battle PoC", 20, 40);
}

requestAnimationFrame(gameLoop);
