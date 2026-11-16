using Microsoft.EntityFrameworkCore;

namespace Catalog;

// Empty on purpose: the tables are added in stage 1.
public class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options);
