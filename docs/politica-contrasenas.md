# Política de contraseñas — AsTeRICS Grid

**Modelo adoptado: el ADMIN custodia las contraseñas de los usuarios.**

---

## Por qué

Los datos de cada usuario están **cifrados con su contraseña**. Consecuencia dura:
- Si un usuario **olvida** su contraseña, sus datos quedan **imposibles de descifrar** (ni el backup
  sirve: también está cifrado con esa clave).
- La **única** forma de recuperarlos ante un olvido es que **alguien todavía sepa la contraseña**.

Como nuestros usuarios son personas con dificultades de comunicación —que en general **no pueden
gestionar sus propias contraseñas**— el modelo lógico es que **el admin las asigne y las guarde**.
Así un olvido es recuperable (el admin la vuelve a proveer) y los datos quedan intactos.

**Trade-off asumido:** con este modelo, el admin **técnicamente podría descifrar** los datos de
cualquier usuario (tiene la contraseña). Es un modelo de **confianza en el admin/cuidador**, no de
privacidad frente a él. Para esta población, es lo apropiado. Si en algún caso un usuario sí puede y
quiere gestionar su propia contraseña, puede hacerlo — pero entonces asume que un olvido = pérdida.

---

## Procedimiento

### Al crear un usuario
1. Asigná una contraseña fuerte (mínimo 8 caracteres; idealmente generada por el gestor).
2. **Guardala INMEDIATAMENTE** en un gestor de contraseñas (Bitwarden, KeePassXC, 1Password…), con:
   - Usuario (el username de la app).
   - Contraseña.
   - Fecha de alta y quién es (nota).
3. Entregá las credenciales al usuario/su familia por un canal seguro.

### Si un usuario olvida la contraseña
1. Buscala en el gestor.
2. Se la volvés a dar → entra y **sus datos siguen intactos** (no hace falta reset ni restore).

> Si por algún motivo hubiera que **cambiar** la contraseña, hay que tener en cuenta que los datos
> viejos (cifrados con la anterior) no se descifran con la nueva. En ese caso: restaurar un backup
> tomado **mientras** se conocía la contraseña vieja, o asumir empezar de cero.

---

## El gestor de contraseñas es ahora un activo crítico

Con este modelo, el gestor de contraseñas pasa a ser **tan importante como los backups**: si se
pierde, se pierde la recuperabilidad de **todos** los usuarios. Por lo tanto:
- Usá un gestor serio y con su **propia copia de seguridad** (export cifrado / sync a la nube).
- Protegé el gestor con una **clave maestra fuerte** y 2FA.
- **No** guardes las contraseñas de usuarios en archivos sueltos, planillas sin cifrar, ni en el
  `docker-compose.yml`.

---

## Resumen de la cadena de recuperación

Para recuperar los datos de un usuario ante cualquier problema hacen falta **dos cosas**:
1. Un **backup** de la base (lo da `backup-offsite.sh`).
2. La **contraseña** del usuario (la da el gestor de contraseñas).

Las dos juntas = recuperación total. Falta una = no alcanza. Por eso **ambas** se cuidan y se
respaldan fuera de la PC.
