from kombu import Queue, Exchange

task_exchange = Exchange('adarsh_tasks', type='direct')

task_queues = (
    Queue('default', task_exchange, routing_key='default'),
    Queue('imports', task_exchange, routing_key='imports'),
    Queue('exports', task_exchange, routing_key='exports'),
    Queue('images', task_exchange, routing_key='images'),
    Queue('notifications', task_exchange, routing_key='notifications'),
    Queue('beat', task_exchange, routing_key='beat'),
)\n