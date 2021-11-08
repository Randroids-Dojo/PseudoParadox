using System;
using TMPro;
using UnityEngine;

namespace _PseudoParadox.Scripts.Core
{
    public class Clock : MonoBehaviour
    {
        public TMP_Text clockText;
        readonly TimeContainer startingTime = new TimeContainer(7, 28, 0);

        DateTime currentDateTime;

        void Start()
        {
            ChangeTime(startingTime);
        }

        // Update is called once per frame
        void Update()
        {
            currentDateTime = currentDateTime.AddSeconds(1 * Time.deltaTime);
            clockText.text = currentDateTime.ToString("HH:mm:ss");
        }


        public void ChangeTime(TimeContainer time)
        {
            currentDateTime = new DateTime(1999, 9, 5, time.hour, time.min, time.sec);
        }
    }
}
