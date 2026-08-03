class RedisKeyFactory:
    PREFIX = "adarsh:"
    
    @classmethod
    def presence(cls, user_id: int) -> str:
        return f"{cls.PREFIX}presence:user:{user_id}"
        
    @classmethod
    def cache(cls, key: str) -> str:
        return f"{cls.PREFIX}cache:{key}"
        
    @classmethod
    def job(cls, job_id: str) -> str:
        return f"{cls.PREFIX}job:{job_id}"
        
    @classmethod
    def lock(cls, resource_name: str) -> str:
        return f"{cls.PREFIX}lock:{resource_name}"
        
    @classmethod
    def session(cls, session_id: str) -> str:
        return f"{cls.PREFIX}session:{session_id}"
        
    @classmethod
    def realtime(cls, topic: str) -> str:
        return f"{cls.PREFIX}realtime:{topic}"\n