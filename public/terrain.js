// Espace chef de terrain : appelle le client, confirme ou refuse le match.

startStaffPage({
  title: "Chef de terrain",
  subtitle: "Connecte-toi pour gérer les réservations.",
  onReady(staff) {
    if (staff.role === "serveur") return location.replace("serveur.html");
    if (staff.role === "cuisine" || staff.role === "bar") return location.replace("cuisine.html");
    $("app").innerHTML = `
      <header class="bo-head">
        <img src="logo707.png" alt="707">
        <div><h1>707 · Terrains</h1><p>${esc(staff.name)}</p></div>
        <span class="spacer"></span>
        ${staff.role === "admin" ? `<a class="btn" href="admin.html">Admin</a>` : ""}
        <button class="btn" id="logout">Sortir</button>
      </header>
      <section id="board"></section>`;
    $("logout").addEventListener("click", staffLogout);
    setInterval(mountPitchBoard($("board")), 6000);
  },
});
