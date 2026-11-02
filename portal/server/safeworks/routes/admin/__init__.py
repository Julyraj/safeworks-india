"""Admin console routers."""
from . import config, qr, sites, system, templates, users

routers = [sites.router, qr.router, qr.link_router, users.router, config.router, templates.router, system.router]
