task_routes = {
    'apps.imports.tasks.*': {'queue': 'imports'},
    'apps.exports.tasks.*': {'queue': 'exports'},
    'apps.mediafiles.tasks.*': {'queue': 'images'},
    'apps.notifications.tasks.*': {'queue': 'notifications'},
    '*': {'queue': 'default'},
}\n