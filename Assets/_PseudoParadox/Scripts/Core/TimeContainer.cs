namespace _PseudoParadox.Scripts.Core
{
    public class TimeContainer
    {
        internal readonly int hour;
        internal readonly int min;
        internal readonly int sec;

        public TimeContainer(int hour, int min, int sec)
        {
            this.hour = hour;
            this.min = min;
            this.sec = sec;
        }
    }
}